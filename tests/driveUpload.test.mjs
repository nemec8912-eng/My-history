// Тесты возобновляемой загрузки на Google Диск частями.
// Запуск: npm test  (node --test; Node ≥ 22.18 исполняет .ts напрямую)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_UNIT,
  DEFAULT_CHUNK,
  NetworkError,
  SessionExpiredError,
  UploadFailedError,
  nextOffsetFromRange,
  resumableUpload,
} from "../lib/media/driveUpload.ts";

const KB = 1024;
const MB = 1024 * KB;

function makeFile(size) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return new Blob([bytes], { type: "video/quicktime" });
}

/**
 * Имитация сервера Google Drive (resumable upload):
 * 308 + Range для незавершённой загрузки, 200 + JSON по завершении, 404 для истёкшей сессии.
 */
function fakeDrive(total, opts = {}) {
  const received = [];
  let have = 0;
  let calls = 0;
  const log = [];
  const state = { expired: false };
  const transport = async (req) => {
    calls++;
    const n = calls;
    const range = req.headers["Content-Range"];
    log.push(range);
    const hook = opts.onCall?.(n, req, have);
    if (hook === "net") throw new NetworkError("simulated drop");
    if (typeof hook === "number") return res(hook);
    if (state.expired) return res(404);
    const status = /^bytes \*\/(\d+)$/.exec(range);
    if (status) {
      if (have === total) return done();
      return have > 0 ? res(308, { Range: `bytes=0-${have - 1}` }) : res(308);
    }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    assert.ok(m, "некорректный Content-Range: " + range);
    const [start, end, size] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.equal(size, total, "неверный общий размер");
    assert.equal(end - start + 1, req.body.size, "размер тела не совпадает с Content-Range");
    if (end + 1 !== total) assert.equal((end - start + 1) % CHUNK_UNIT, 0, "часть не кратна 256 КиБ");
    if (start !== have) return res(308, have ? { Range: `bytes=0-${have - 1}` } : {});
    const buf = new Uint8Array(await req.body.arrayBuffer());
    // Отчёт о реально отправленных байтах (как upload.onprogress).
    req.onProgress?.(Math.floor(buf.length / 2));
    if (hook === "drop-mid") {
      // Половина ушла, потом обрыв — сервер сохранил только целые 256 КиБ.
      const kept = Math.floor(buf.length / 2 / CHUNK_UNIT) * CHUNK_UNIT;
      received.push(buf.slice(0, kept));
      have += kept;
      throw new NetworkError("drop mid-chunk");
    }
    req.onProgress?.(buf.length);
    const keep = hook === "partial" ? Math.max(CHUNK_UNIT, Math.floor(buf.length / 2 / CHUNK_UNIT) * CHUNK_UNIT) : buf.length;
    received.push(buf.slice(0, keep));
    have += keep;
    if (have === total) return done();
    return res(308, { Range: `bytes=0-${have - 1}` });
  };
  function res(status, headers = {}) {
    return { status, header: (k) => headers[k] ?? null, text: "" };
  }
  function done() {
    return { status: 200, header: () => null, text: JSON.stringify({ id: "file-123", size: String(total) }) };
  }
  return {
    transport,
    state,
    log,
    get calls() {
      return calls;
    },
    get have() {
      return have;
    },
    bytes() {
      const out = new Uint8Array(have);
      let o = 0;
      for (const b of received) {
        out.set(b, o);
        o += b.length;
      }
      return out;
    },
  };
}

async function sameBytes(blob, bytes) {
  const src = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes.length, src.length, "длина не совпадает");
  assert.ok(Buffer.from(src).equals(Buffer.from(bytes)), "содержимое не совпадает");
}

function progressRecorder() {
  const events = [];
  return {
    events,
    onProgress: (p) => events.push(p),
    check(total) {
      assert.ok(events.length > 0, "не было событий прогресса");
      for (const e of events) {
        assert.ok(e.loaded >= 0 && e.loaded <= total, "прогресс вне диапазона");
        assert.equal(e.total, total);
      }
      assert.equal(events.at(-1).loaded, total, "прогресс не дошёл до 100%");
    },
  };
}

const base = (file, drive, extra = {}) => ({
  sessionUrl: "https://upload.example/session",
  getSource: async () => file,
  size: file.size,
  transport: drive.transport,
  fresh: true,
  sleep: async () => undefined,
  ...extra,
});

test("размер части по умолчанию: 8 МиБ, кратно 256 КиБ", () => {
  assert.equal(DEFAULT_CHUNK, 8 * MB);
  assert.equal(DEFAULT_CHUNK % CHUNK_UNIT, 0);
});

test("разбор заголовка Range", () => {
  assert.equal(nextOffsetFromRange("bytes=0-1048575"), 1048576);
  assert.equal(nextOffsetFromRange(null), null);
  assert.equal(nextOffsetFromRange("garbage"), null);
});

test("маленькое видео: один запрос, прогресс до 100%", async () => {
  const file = makeFile(300 * KB);
  const drive = fakeDrive(file.size);
  const p = progressRecorder();
  const out = await resumableUpload(base(file, drive, { onProgress: p.onProgress }));
  assert.deepEqual(out, { id: "file-123", size: file.size });
  assert.equal(drive.calls, 1);
  assert.equal(drive.log[0], `bytes 0-${file.size - 1}/${file.size}`);
  p.check(file.size);
  await sameBytes(file, drive.bytes());
});

test("большое видео: части по порядку с корректным Content-Range, процент растёт", async () => {
  const file = makeFile(5 * MB + 123);
  const drive = fakeDrive(file.size);
  const p = progressRecorder();
  await resumableUpload(base(file, drive, { chunkSize: MB, onProgress: p.onProgress }));
  assert.equal(drive.calls, 6);
  assert.equal(drive.log[0], `bytes 0-${MB - 1}/${file.size}`);
  assert.equal(drive.log[5], `bytes ${5 * MB}-${file.size - 1}/${file.size}`);
  p.check(file.size);
  // Прогресс не уменьшается при стабильной связи.
  for (let i = 1; i < p.events.length; i++) assert.ok(p.events[i].loaded >= p.events[i - 1].loaded);
  // Есть промежуточные значения внутри части (реальные байты, не только по завершении части).
  assert.ok(p.events.some((e) => e.loaded % MB !== 0 && e.loaded < file.size));
  await sameBytes(file, drive.bytes());
});

test("размер части округляется вниз до кратного 256 КиБ", async () => {
  const file = makeFile(2 * MB);
  const drive = fakeDrive(file.size);
  await resumableUpload(base(file, drive, { chunkSize: 300 * KB }));
  assert.equal(drive.log[0], `bytes 0-${CHUNK_UNIT - 1}/${file.size}`);
  await sameBytes(file, drive.bytes());
});

test("обрыв связи посреди части: продолжение с подтверждённого места, а не с нуля", async () => {
  const file = makeFile(4 * MB);
  const drive = fakeDrive(file.size, { onCall: (n) => (n === 3 ? "drop-mid" : undefined) });
  const p = progressRecorder();
  await resumableUpload(base(file, drive, { chunkSize: MB, onProgress: p.onProgress }));
  // После обрыва — запрос статуса, затем дослать остаток третьей части.
  const statusIdx = drive.log.findIndex((r) => r.startsWith("bytes */"));
  assert.ok(statusIdx > 0, "не было запроса статуса");
  assert.equal(drive.log[statusIdx + 1], `bytes ${2 * MB + MB / 2}-${3 * MB + MB / 2 - 1}/${file.size}`);
  assert.ok(!drive.log.slice(statusIdx + 1).some((r) => r.startsWith("bytes 0-")), "загрузка началась заново");
  assert.ok(p.events.some((e) => e.phase === "retrying"), "не было статуса повторной попытки");
  p.check(file.size);
  await sameBytes(file, drive.bytes());
});

test("сервер принял меньше, чем отправлено: следующая часть с места из Range", async () => {
  const file = makeFile(3 * MB);
  const drive = fakeDrive(file.size, { onCall: (n) => (n === 1 ? "partial" : undefined) });
  await resumableUpload(base(file, drive, { chunkSize: MB }));
  assert.equal(drive.log[1], `bytes ${MB / 2}-${MB / 2 + MB - 1}/${file.size}`);
  await sameBytes(file, drive.bytes());
});

test("временная ошибка сервера 503 → повтор и успех", async () => {
  const file = makeFile(2 * MB);
  let sleeps = 0;
  const drive = fakeDrive(file.size, { onCall: (n) => (n === 2 ? 503 : undefined) });
  await resumableUpload(base(file, drive, { chunkSize: MB, sleep: async () => void sleeps++ }));
  assert.equal(sleeps, 1);
  await sameBytes(file, drive.bytes());
});

test("медленное соединение: много мелких событий прогресса, без ошибок", async () => {
  const file = makeFile(2 * MB);
  const drive = fakeDrive(file.size);
  const slow = async (req) => {
    // Байты уходят по 64 КиБ с паузами.
    const orig = req.onProgress;
    const size = req.body?.size ?? 0;
    for (let sent = 0; sent < size; sent += 64 * KB) {
      orig?.(sent);
      await new Promise((r) => setTimeout(r, 1));
    }
    return drive.transport(req);
  };
  const p = progressRecorder();
  await resumableUpload(base(file, drive, { transport: slow, chunkSize: MB, onProgress: p.onProgress }));
  assert.ok(p.events.length > 30);
  p.check(file.size);
});

test("повторы исчерпаны → понятная ошибка; «Повторить» продолжает ту же сессию", async () => {
  const file = makeFile(3 * MB);
  let down = true;
  const drive = fakeDrive(file.size, { onCall: (n) => (n >= 2 && down ? "net" : undefined) });
  await assert.rejects(
    resumableUpload(base(file, drive, { chunkSize: MB, maxRetries: 3 })),
    (e) => e instanceof UploadFailedError
  );
  assert.equal(drive.have, MB);
  // Связь вернулась, пользователь нажал «Повторить»: та же сессия, fresh=false.
  down = false;
  const before = drive.log.length;
  await resumableUpload(base(file, drive, { chunkSize: MB, fresh: false }));
  assert.equal(drive.log[before], `bytes */${file.size}`);
  assert.equal(drive.log[before + 1], `bytes ${MB}-${2 * MB - 1}/${file.size}`);
  await sameBytes(file, drive.bytes());
});

test("нет интернета: ждём сети, не расходуя попытки впустую", async () => {
  const file = makeFile(2 * MB);
  let online = true;
  let waited = 0;
  const drive = fakeDrive(file.size, {
    onCall: (n) => {
      if (n === 2) {
        online = false;
        return "net";
      }
    },
  });
  const p = progressRecorder();
  await resumableUpload(
    base(file, drive, {
      chunkSize: MB,
      isOnline: () => online,
      waitOnline: async () => {
        waited++;
        online = true;
      },
      onProgress: p.onProgress,
    })
  );
  assert.equal(waited, 1);
  assert.ok(p.events.some((e) => e.phase === "waiting-net"));
  await sameBytes(file, drive.bytes());
});

test("продолжение после перезапуска, когда сервер уже всё принял: ничего не отправляем повторно", async () => {
  const file = makeFile(MB);
  const drive = fakeDrive(file.size);
  await resumableUpload(base(file, drive, { chunkSize: MB }));
  const before = drive.calls;
  const out = await resumableUpload(base(file, drive, { chunkSize: MB, fresh: false }));
  assert.equal(out.id, "file-123");
  assert.equal(drive.calls, before + 1); // только запрос статуса
});

test("истёкшая сессия (404) → SessionExpiredError, чтобы создать новую", async () => {
  const file = makeFile(MB);
  const drive = fakeDrive(file.size);
  drive.state.expired = true;
  await assert.rejects(resumableUpload(base(file, drive, { fresh: false })), (e) => e instanceof SessionExpiredError);
});

test("постоянная ошибка (403) не повторяется бесконечно", async () => {
  const file = makeFile(MB);
  const drive = fakeDrive(file.size, { onCall: () => 403 });
  await assert.rejects(resumableUpload(base(file, drive)), (e) => e instanceof UploadFailedError && e.status === 403);
  assert.equal(drive.calls, 1);
});

test("источник подменён (другой размер) → ошибка, а не порча файла на Диске", async () => {
  const file = makeFile(MB);
  const drive = fakeDrive(file.size);
  await assert.rejects(resumableUpload(base(file, drive, { getSource: async () => makeFile(10) })), UploadFailedError);
  assert.equal(drive.calls, 0);
});

/**
 * Настоящая возобновляемая (resumable) загрузка на Google Диск частями.
 *
 * Протокол: https://developers.google.com/drive/api/guides/manage-uploads#resumable
 *  - сессия создаётся отдельно (POST …?uploadType=resumable → Location);
 *  - каждая часть уходит отдельным PUT с заголовком Content-Range;
 *  - сервер отвечает 308 + Range: bytes=0-N, пока файл не принят целиком, затем 200/201 с JSON;
 *  - узнать, сколько байт уже принято: PUT без тела, Content-Range: bytes * /SIZE (без пробела).
 *
 * Модуль не зависит от DOM: транспорт (XHR в браузере, заглушка в тестах) передаётся снаружи.
 */

/** 256 КиБ — требование Google: размер каждой части (кроме последней) кратен ему. */
export const CHUNK_UNIT = 256 * 1024;
/**
 * 8 МиБ: достаточно крупно для скорости (меньше запросов и рукопожатий),
 * но достаточно мелко, чтобы мобильный Safari не держал в памяти большие буферы
 * и чтобы при обрыве повторно отправлялось немного данных.
 */
export const DEFAULT_CHUNK = 32 * CHUNK_UNIT;

export type HttpResult = { status: number; header: (name: string) => string | null; text: string };

export type HttpRequest = {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  body: Blob | null;
  /** Сколько байт тела запроса уже отправлено (реальные байты из события upload.progress). */
  onProgress?: (sentBytes: number) => void;
};

/** Транспорт: при сетевой ошибке/обрыве/зависании отклоняет промис с NetworkError. */
export type Transport = (req: HttpRequest) => Promise<HttpResult>;

export class NetworkError extends Error {
  constructor(message = "network") {
    super(message);
    this.name = "NetworkError";
  }
}
/** Сессия загрузки больше не существует (истекла через ~неделю или отменена) — нужна новая. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Сессия загрузки Google Диска истекла");
    this.name = "SessionExpiredError";
  }
}
/** Автоматические повторы исчерпаны — нужен ручной «Повторить». */
export class UploadFailedError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "UploadFailedError";
    this.status = status;
  }
}

export type UploadProgress = {
  /** Байты, реально переданные и (для завершённых частей) подтверждённые сервером. */
  loaded: number;
  total: number;
  phase: "uploading" | "retrying" | "waiting-net";
  attempt?: number;
};

export type ResumableOptions = {
  sessionUrl: string;
  /** Источник байтов. Вызывается заново при каждом повторе — можно переключиться на копию из IndexedDB. */
  getSource: () => Promise<Blob>;
  size: number;
  mime?: string;
  transport: Transport;
  /** true — сессия создана только что и сервер точно ничего не принял (не нужен лишний запрос статуса). */
  fresh?: boolean;
  chunkSize?: number;
  /** Сколько подряд неудачных попыток допускается для одной части. */
  maxRetries?: number;
  onProgress?: (p: UploadProgress) => void;
  sleep?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
  /** Ждёт возвращения сети (или таймаута) — чтобы не тратить попытки, пока телефон офлайн. */
  waitOnline?: (maxMs: number) => Promise<void>;
};

export type DriveFile = { id: string; size: number };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Разбор заголовка Range ("bytes=0-1048575") → следующий смещение. null — заголовка нет. */
export function nextOffsetFromRange(range: string | null): number | null {
  if (!range) return null;
  const m = /bytes=(\d+)-(\d+)/.exec(range);
  return m ? Number(m[2]) + 1 : null;
}

function parseFile(res: HttpResult, size: number): DriveFile {
  let data: { id?: string; size?: string | number } = {};
  try {
    data = JSON.parse(res.text || "{}");
  } catch {
    /* пустой или нестандартный ответ */
  }
  if (!data.id) throw new UploadFailedError("Google Диск не вернул идентификатор файла", res.status);
  return { id: data.id, size: Number(data.size ?? size) };
}

const isDone = (s: number) => s === 200 || s === 201;
const isGone = (s: number) => s === 404 || s === 410;
/** Временные ошибки, после которых имеет смысл повторить (с запросом статуса). */
const isRetryable = (s: number) => s === 0 || s === 408 || s === 429 || s >= 500 || s === 400;

/** Экспоненциальная пауза: 1, 2, 4, 8, 16, 30… с; небольшой разброс, чтобы не биться в такт. */
export function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

type Status = { done: DriveFile } | { offset: number };

/** Сколько байт сервер уже принял. */
export async function queryUploadStatus(sessionUrl: string, size: number, transport: Transport): Promise<Status> {
  const res = await transport({ method: "PUT", url: sessionUrl, headers: { "Content-Range": `bytes */${size}` }, body: null });
  if (isDone(res.status)) return { done: parseFile(res, size) };
  if (isGone(res.status)) throw new SessionExpiredError();
  if (res.status === 308) return { offset: nextOffsetFromRange(res.header("Range")) ?? 0 };
  throw new UploadFailedError(`Google Диск: статус загрузки ${res.status}`, res.status);
}

/**
 * Отправляет файл частями в существующую сессию, продолжая с того места, где сервер остановился.
 * Прогресс считается по реально отправленным байтам: смещение подтверждённых частей + байты текущей части.
 */
export async function resumableUpload(o: ResumableOptions): Promise<DriveFile> {
  const chunk = Math.max(CHUNK_UNIT, Math.floor((o.chunkSize ?? DEFAULT_CHUNK) / CHUNK_UNIT) * CHUNK_UNIT);
  const maxRetries = o.maxRetries ?? 6;
  const sleep = o.sleep ?? defaultSleep;
  const online = o.isOnline ?? (() => true);
  const total = o.size;
  const report = (loaded: number, phase: UploadProgress["phase"] = "uploading", attempt?: number) =>
    o.onProgress?.({ loaded: Math.min(total, Math.max(0, loaded)), total, phase, attempt });

  let offset = 0;
  let failures = 0;
  let needStatus = !o.fresh;

  // Пустой файл: один запрос без тела.
  if (total === 0) {
    const res = await o.transport({ method: "PUT", url: o.sessionUrl, headers: { "Content-Range": "bytes */0" }, body: null });
    if (isDone(res.status)) return parseFile(res, 0);
    throw new UploadFailedError(`Google Диск: загрузка не удалась (${res.status})`, res.status);
  }

  for (;;) {
    if (needStatus) {
      try {
        const st = await queryUploadStatus(o.sessionUrl, total, o.transport);
        if ("done" in st) {
          report(total);
          return st.done;
        }
        offset = st.offset;
        needStatus = false;
        report(offset);
      } catch (e) {
        if (e instanceof SessionExpiredError) throw e;
        if (!(e instanceof NetworkError) && !(e instanceof UploadFailedError && isRetryable(e.status ?? 0))) throw e;
        failures++;
        if (failures > maxRetries) throw new UploadFailedError("Не удалось связаться с Google Диском");
        await pause(failures);
        continue;
      }
    }

    const end = Math.min(offset + chunk, total);
    let res: HttpResult | null = null;
    try {
      const source = await o.getSource();
      if (source.size !== total) throw new UploadFailedError("Исходный файл изменился или недоступен");
      const start = offset;
      res = await o.transport({
        method: "PUT",
        url: o.sessionUrl,
        headers: {
          "Content-Range": `bytes ${start}-${end - 1}/${total}`,
          ...(o.mime ? { "Content-Type": o.mime } : {}),
        },
        // slice() у File не копирует данные: браузер читает нужный кусок с диска при отправке.
        body: source.slice(start, end),
        onProgress: (sent) => report(start + Math.min(sent, end - start), failures ? "retrying" : "uploading", failures || undefined),
      });
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      res = null;
    }

    if (res && isDone(res.status)) {
      report(total);
      return parseFile(res, total);
    }
    if (res && res.status === 308) {
      // Сервер мог принять не всё, что ему отправили, — продолжаем с подтверждённого места.
      const next = nextOffsetFromRange(res.header("Range"));
      offset = next ?? end;
      failures = 0;
      report(offset);
      continue;
    }
    if (res && isGone(res.status)) throw new SessionExpiredError();
    if (res && !isRetryable(res.status)) {
      throw new UploadFailedError(`Google Диск: загрузка не удалась (${res.status})`, res.status);
    }

    // Обрыв связи или временная ошибка сервера: ждём и уточняем, сколько байт уже принято.
    failures++;
    if (failures > maxRetries) throw new UploadFailedError("Не удалось загрузить видео: связь нестабильна", res?.status);
    await pause(failures);
    needStatus = true;
  }

  async function pause(attempt: number) {
    if (!online() && o.waitOnline) {
      report(offset, "waiting-net", attempt);
      await o.waitOnline(5 * 60_000);
    }
    report(offset, "retrying", attempt);
    await sleep(backoffMs(attempt));
  }
}

/* ───────────── Браузерный транспорт на XMLHttpRequest ───────────── */

/**
 * fetch() в Safari не сообщает прогресс отправки, поэтому используется XHR (upload.onprogress).
 * Вместо общего таймаута — сторожевой таймер «нет прогресса N секунд»: медленная, но живая
 * связь не обрывается, а зависшее соединение распознаётся и повторяется.
 */
export function xhrTransport(stallMs = 45_000): Transport {
  return (req) =>
    new Promise<HttpResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let last = Date.now();
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        fn();
      };
      const watchdog = setInterval(() => {
        if (Date.now() - last > stallMs) {
          xhr.abort();
          finish(() => reject(new NetworkError("stalled")));
        }
      }, 2000);
      xhr.open(req.method, req.url, true);
      for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        last = Date.now();
        req.onProgress?.(e.loaded);
      };
      xhr.onprogress = () => (last = Date.now());
      xhr.onload = () =>
        finish(() => {
          // status 0 при onload — CORS/сетевой сбой.
          if (xhr.status === 0) return reject(new NetworkError("status 0"));
          resolve({ status: xhr.status, header: (n) => xhr.getResponseHeader(n), text: xhr.responseText });
        });
      xhr.onerror = () => finish(() => reject(new NetworkError("xhr error")));
      xhr.onabort = () => finish(() => reject(new NetworkError("aborted")));
      xhr.ontimeout = () => finish(() => reject(new NetworkError("timeout")));
      xhr.send(req.body);
    });
}

/** Ждёт события online (или таймаута). */
export function waitOnlineBrowser(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || navigator.onLine) return resolve();
    const done = () => {
      window.removeEventListener("online", done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, maxMs);
    window.addEventListener("online", done);
  });
}

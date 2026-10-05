/**
 * Google Фото через Google Takeout: архив(ы) .zip или распакованная папка.
 * Дата и место — из EXIF самого фото (местное время съёмки), иначе из описаний Takeout (*.json).
 * Повторы (то же фото в папке года и в альбоме, «-edited»-копии) убираются.
 */
import { localIso, parseExif } from "./exif";
import { mp4CreationDate } from "./mp4date";
import { listZip, readZipEntry, readZipEntryHead, type ZipEntry } from "./zip";
import type { GeoPoint } from "./types";

export type TakeoutItem = {
  key: string;
  name: string;
  kind: "image" | "video";
  size: number;
  takenAt?: string;
  gps?: GeoPoint;
  fromMeta: boolean;
  load: () => Promise<File>;
};

const MEDIA = /\.(jpe?g|png|heic|heif|webp|gif|mp4|mov|m4v|3gp|avi)$/i;
const VIDEO = /\.(mp4|mov|m4v|3gp|avi)$/i;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", "3gp": "video/3gpp", avi: "video/x-msvideo" };
const mimeOf = (n: string) => MIME[n.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
const base = (p: string) => p.split("/").pop() ?? p;
const dir = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
const EDITED = /-(edited|изменено|bearbeitet|modifié|modificato|editado)(?=(\(\d+\))?\.\w+$)/i;

type Meta = { title?: string; photoTakenTime?: { timestamp?: string }; creationTime?: { timestamp?: string }; geoData?: { latitude: number; longitude: number }; geoDataExif?: { latitude: number; longitude: number } };

function fromMeta(m: Meta): { takenAt?: string; gps?: GeoPoint } {
  const ts = Number(m.photoTakenTime?.timestamp ?? m.creationTime?.timestamp);
  const g = m.geoData?.latitude || m.geoData?.longitude ? m.geoData : m.geoDataExif;
  return {
    // Google хранит время по Гринвичу; переводим по часовому поясу устройства (точнее — EXIF, он важнее).
    takenAt: ts ? localIso(new Date(ts * 1000)) : undefined,
    gps: g && (g.latitude || g.longitude) ? { lat: g.latitude, lon: g.longitude } : undefined,
  };
}

/** Индекс описаний: точные имена, имена с (n), обрезанные имена (Google режет имя до ~46 символов) и по title. */
class MetaIndex {
  private byPath = new Map<string, Meta>();
  private byDir = new Map<string, string[]>();
  private byTitle = new Map<string, Meta>();
  add(path: string, m: Meta) {
    this.byPath.set(path, m);
    const d = dir(path);
    if (!this.byDir.has(d)) this.byDir.set(d, []);
    this.byDir.get(d)!.push(base(path));
    if (m.title && !this.byTitle.has(d + m.title)) this.byTitle.set(d + m.title, m);
  }
  get size() {
    return this.byPath.size;
  }
  find(path: string): Meta | undefined {
    const d = dir(path);
    let b = base(path);
    const tryName = (n: string) => this.byPath.get(d + n + ".json") ?? this.byPath.get(d + n + ".supplemental-metadata.json");
    const exact = tryName(b);
    if (exact) return exact;
    // IMG_1(1).jpg → IMG_1.jpg(1).json / IMG_1.jpg.supplemental-metadata(1).json
    const dup = b.match(/^(.*)\((\d+)\)(\.\w+)$/);
    if (dup) {
      const [, stem, n, ext] = dup;
      const m = this.byPath.get(`${d}${stem}${ext}(${n}).json`) ?? this.byPath.get(`${d}${stem}${ext}.supplemental-metadata(${n}).json`);
      if (m) return m;
    }
    // «-edited»-копия берёт описание оригинала.
    if (EDITED.test(b)) {
      b = b.replace(EDITED, "");
      const m = tryName(b);
      if (m) return m;
    }
    const byTitle = this.byTitle.get(d + b);
    if (byTitle) return byTitle;
    // Обрезанные имена описаний: самый длинный общий префикс в той же папке.
    const names = this.byDir.get(d) ?? [];
    const stem = b.replace(/\.\w+$/, "");
    const hit = names.find((n) => n.length >= 20 && b.startsWith(n.replace(/(\.supplemental-metadata)?(\(\d+\))?\.json$/, "").replace(/\.\w*$/, "").slice(0, 40)) && n.startsWith(stem.slice(0, Math.min(stem.length, 30))));
    return hit ? this.byPath.get(d + hit) : undefined;
  }
}

type Entry = { path: string; size: number; load: () => Promise<File>; head: (n: number) => Promise<Blob> };

async function finish(entries: Entry[], metas: MetaIndex, onProgress?: (s: string) => void): Promise<TakeoutItem[]> {
  const out: TakeoutItem[] = [];
  let n = 0;
  for (const e of entries) {
    if (++n % 50 === 0) onProgress?.(`Читаю даты и места: ${n} из ${entries.length}…`);
    const m = metas.find(e.path);
    let info: { takenAt?: string; gps?: GeoPoint } = m ? fromMeta(m) : {};
    const kind = VIDEO.test(e.path) ? "video" : "image";
    // Для JPEG — время из EXIF: это местное время съёмки, а не время по поясу этого телефона.
    if (kind === "image" && /\.jpe?g$/i.test(e.path)) {
      const head = await e.head(256 * 1024).catch(() => null);
      if (head) {
        const x = parseExif(await head.arrayBuffer());
        if (x.takenAt) info = { takenAt: x.takenAt, gps: x.gps ?? info.gps };
      }
    }
    if (!info.takenAt && kind === "video") {
      const f = e.size < 600 * 1024 * 1024 ? await e.load().catch(() => null) : null;
      if (f) info.takenAt = await mp4CreationDate(f);
    }
    out.push({ key: `${n}:${e.path}`, name: base(e.path), kind, size: e.size, takenAt: info.takenAt, gps: info.gps, fromMeta: Boolean(m) || Boolean(info.takenAt), load: e.load });
  }
  return dedupe(out);
}

/** Одно и то же фото лежит и в «Photos from 2023», и в папке альбома; рядом бывают «-edited»-копии. */
function dedupe(items: TakeoutItem[]): TakeoutItem[] {
  const key = (i: TakeoutItem) => `${i.name.replace(EDITED, "").replace(/\(\d+\)(?=\.\w+$)/, "").toLowerCase()}|${i.takenAt ?? ""}`;
  const best = new Map<string, TakeoutItem>();
  for (const i of items) {
    const k = key(i);
    const cur = best.get(k);
    // Оставляем отредактированную версию (её вы видели в Google Фото), иначе первую.
    if (!cur || (EDITED.test(i.name) && !EDITED.test(cur.name))) best.set(k, i);
  }
  return Array.from(best.values());
}

/** Один или несколько архивов Takeout: описания собираются из всех частей, потом сопоставляются с фото. */
export async function readTakeoutZips(files: File[], onProgress?: (s: string) => void): Promise<TakeoutItem[]> {
  const metas = new MetaIndex();
  const lists: { file: File; list: ZipEntry[] }[] = [];
  for (const file of files) {
    onProgress?.(`Читаю оглавление ${file.name}…`);
    lists.push({ file, list: await listZip(file) });
  }
  const jsons = lists.flatMap(({ file, list }) => list.filter((e) => e.name.endsWith(".json") && e.size < 200_000).map((e) => ({ file, e })));
  let i = 0;
  for (const { file, e } of jsons) {
    if (++i % 100 === 0) onProgress?.(`Читаю описания: ${i} из ${jsons.length}…`);
    try {
      metas.add(e.name, JSON.parse(await (await readZipEntry(file, e)).text()));
    } catch {
      /* не описание фото */
    }
  }
  const entries: Entry[] = lists.flatMap(({ file, list }) =>
    list
      .filter((e) => MEDIA.test(e.name))
      .map((e) => ({
        path: e.name,
        size: e.size,
        load: async () => new File([await readZipEntry(file, e, mimeOf(e.name))], base(e.name), { type: mimeOf(e.name) }),
        head: (n: number) => readZipEntryHead(file, e, n),
      }))
  );
  return finish(entries, metas, onProgress);
}

/** Распакованная папка Takeout или просто набор файлов вместе с их .json. */
export async function readTakeoutFiles(files: File[], onProgress?: (s: string) => void): Promise<TakeoutItem[]> {
  const path = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const metas = new MetaIndex();
  for (const f of files.filter((x) => x.name.endsWith(".json") && x.size < 200_000)) {
    try {
      metas.add(path(f), JSON.parse(await f.text()));
    } catch {
      /* пропускаем */
    }
  }
  const media = files.filter((f) => MEDIA.test(f.name));
  return finish(
    media.map((f) => ({ path: path(f), size: f.size, load: async () => f, head: async (n: number) => f.slice(0, n) })),
    metas,
    onProgress
  );
}

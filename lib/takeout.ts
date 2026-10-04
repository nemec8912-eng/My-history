/**
 * Google Фото через Google Takeout: архив (.zip) или распакованная папка.
 * Дата и место берутся из файлов-описаний Takeout (*.json), а если их нет — из EXIF.
 */
import { localIso, readPhotoInfo } from "./exif";
import { listZip, readZipEntry, type ZipEntry } from "./zip";
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

type Meta = { title?: string; photoTakenTime?: { timestamp?: string }; creationTime?: { timestamp?: string }; geoData?: { latitude: number; longitude: number }; geoDataExif?: { latitude: number; longitude: number } };

function fromMeta(m: Meta): { takenAt?: string; gps?: GeoPoint } {
  const ts = Number(m.photoTakenTime?.timestamp ?? m.creationTime?.timestamp);
  const g = m.geoData?.latitude || m.geoData?.longitude ? m.geoData : m.geoDataExif;
  return {
    takenAt: ts ? localIso(new Date(ts * 1000)) : undefined,
    gps: g && (g.latitude || g.longitude) ? { lat: g.latitude, lon: g.longitude } : undefined,
  };
}

/** Описание для файла: «IMG_1.JPG.json», «IMG_1.JPG.supplemental-metadata.json», обрезанные имена — по title. */
function matchMeta(path: string, metas: Map<string, Meta>, byTitle: Map<string, Meta>): Meta | undefined {
  const d = dir(path);
  const b = base(path);
  return (
    metas.get(d + b + ".json") ??
    metas.get(d + b + ".supplemental-metadata.json") ??
    Array.from(metas.entries()).find(([k]) => k.startsWith(d + b.slice(0, 40)) && k.endsWith(".json"))?.[1] ??
    byTitle.get(d + b) ??
    byTitle.get(d + b.replace(/\(\d+\)(\.\w+)$/, "$1"))
  );
}

async function finish(entries: { path: string; size: number; load: () => Promise<File> }[], metas: Map<string, Meta>, onProgress?: (s: string) => void): Promise<TakeoutItem[]> {
  const byTitle = new Map<string, Meta>();
  for (const [k, m] of metas) if (m.title) byTitle.set(dir(k) + m.title, m);
  const out: TakeoutItem[] = [];
  let n = 0;
  for (const e of entries) {
    if (++n % 50 === 0) onProgress?.(`Читаю даты и места: ${n} из ${entries.length}…`);
    const m = matchMeta(e.path, metas, byTitle);
    let info = m ? fromMeta(m) : {};
    const kind = VIDEO.test(e.path) ? "video" : "image";
    // Нет описания — пробуем EXIF самого фото (только JPEG, читаем начало файла).
    if (!info.takenAt && kind === "image" && /\.jpe?g$/i.test(e.path)) {
      const f = await e.load().catch(() => null);
      if (f) {
        const x = await readPhotoInfo(f).catch(() => null);
        if (x?.fromExif) info = { takenAt: x.takenAt, gps: x.gps };
      }
    }
    out.push({ key: `${n}:${e.path}`, name: base(e.path), kind, size: e.size, takenAt: info.takenAt, gps: info.gps, fromMeta: Boolean(m), load: e.load });
  }
  return out;
}

export async function readTakeoutZip(file: File, onProgress?: (s: string) => void): Promise<TakeoutItem[]> {
  onProgress?.("Читаю оглавление архива…");
  const list = await listZip(file);
  const metas = new Map<string, Meta>();
  const jsons = list.filter((e) => e.name.endsWith(".json") && e.size < 200_000);
  let i = 0;
  for (const e of jsons) {
    if (++i % 100 === 0) onProgress?.(`Читаю описания: ${i} из ${jsons.length}…`);
    try {
      metas.set(e.name, JSON.parse(await (await readZipEntry(file, e)).text()));
    } catch {
      /* не описание фото */
    }
  }
  const media = list.filter((e) => MEDIA.test(e.name));
  const load = (e: ZipEntry) => async () => new File([await readZipEntry(file, e, mimeOf(e.name))], base(e.name), { type: mimeOf(e.name) });
  return finish(media.map((e) => ({ path: e.name, size: e.size, load: load(e) })), metas, onProgress);
}

/** Распакованная папка Takeout или просто набор файлов вместе с их .json. */
export async function readTakeoutFiles(files: File[], onProgress?: (s: string) => void): Promise<TakeoutItem[]> {
  const path = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const metas = new Map<string, Meta>();
  for (const f of files.filter((x) => x.name.endsWith(".json") && x.size < 200_000)) {
    try {
      metas.set(path(f), JSON.parse(await f.text()));
    } catch {
      /* пропускаем */
    }
  }
  const media = files.filter((f) => MEDIA.test(f.name));
  return finish(media.map((f) => ({ path: path(f), size: f.size, load: async () => f })), metas, onProgress);
}

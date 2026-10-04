/**
 * Чтение даты съёмки и GPS из EXIF фотографии (JPEG). Без внешних библиотек.
 * Читаем исходный файл до сжатия: при пересохранении через canvas EXIF теряется.
 */
import type { GeoPoint } from "./types";

export type PhotoInfo = {
  /** YYYY-MM-DDTHH:MM:SS (местное время съёмки). */
  takenAt?: string;
  gps?: GeoPoint;
};

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;

function parseTiff(view: DataView, start: number): PhotoInfo {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (o: number) => view.getUint16(start + o, little);
  const u32 = (o: number) => view.getUint32(start + o, little);
  if (u16(2) !== 42) return {};

  type Entry = { tag: number; type: number; count: number; valueOffset: number; entryOffset: number };
  const readIfd = (offset: number): Entry[] => {
    if (offset <= 0 || start + offset + 2 > view.byteLength) return [];
    const n = u16(offset);
    const out: Entry[] = [];
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      if (start + e + 12 > view.byteLength) break;
      out.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), valueOffset: u32(e + 8), entryOffset: e + 8 });
    }
    return out;
  };
  const ascii = (e: Entry) => {
    const off = e.count > 4 ? e.valueOffset : e.entryOffset;
    let s = "";
    for (let i = 0; i < e.count - 1 && start + off + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(start + off + i));
    return s.trim();
  };
  const rationals = (e: Entry) => {
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) {
      const o = e.valueOffset + i * 8;
      if (start + o + 8 > view.byteLength) break;
      const den = u32(o + 4);
      out.push(den ? u32(o) / den : 0);
    }
    return out;
  };

  const ifd0 = readIfd(u32(4));
  const info: PhotoInfo = {};
  let date = ifd0.find((e) => e.tag === TAG_DATETIME);
  const exifPtr = ifd0.find((e) => e.tag === TAG_EXIF_IFD);
  if (exifPtr) {
    const orig = readIfd(exifPtr.valueOffset).find((e) => e.tag === TAG_DATETIME_ORIGINAL);
    if (orig) date = orig;
  }
  if (date) {
    const m = ascii(date).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m && m[1] !== "0000") info.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  const gpsPtr = ifd0.find((e) => e.tag === TAG_GPS_IFD);
  if (gpsPtr) {
    const g = readIfd(gpsPtr.valueOffset);
    const latRef = g.find((e) => e.tag === 1);
    const lat = g.find((e) => e.tag === 2);
    const lonRef = g.find((e) => e.tag === 3);
    const lon = g.find((e) => e.tag === 4);
    if (lat && lon) {
      const dms = (v: number[]) => (v[0] ?? 0) + (v[1] ?? 0) / 60 + (v[2] ?? 0) / 3600;
      let la = dms(rationals(lat));
      let lo = dms(rationals(lon));
      if (latRef && ascii(latRef).startsWith("S")) la = -la;
      if (lonRef && ascii(lonRef).startsWith("W")) lo = -lo;
      if ((la || lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) info.gps = { lat: la, lon: lo };
    }
  }
  return info;
}

/** Разбирает EXIF из начала JPEG-файла. */
export function parseExif(buf: ArrayBuffer): PhotoInfo {
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};
  let o = 2;
  while (o + 4 < view.byteLength) {
    if (view.getUint8(o) !== 0xff) return {};
    const marker = view.getUint8(o + 1);
    const len = view.getUint16(o + 2);
    if (marker === 0xe1 && o + 10 < view.byteLength && view.getUint32(o + 4) === 0x45786966 /* "Exif" */) {
      try {
        return parseTiff(view, o + 10);
      } catch {
        return {};
      }
    }
    if (marker === 0xda) break; // начались данные изображения
    o += 2 + len;
  }
  return {};
}

const pad = (n: number) => String(n).padStart(2, "0");
export const localIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Дата и место съёмки. Если EXIF нет — время изменения файла (без места). */
export async function readPhotoInfo(file: File): Promise<PhotoInfo & { fromExif: boolean }> {
  let info: PhotoInfo = {};
  if (/jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name)) {
    try {
      info = parseExif(await file.slice(0, 512 * 1024).arrayBuffer());
    } catch {
      info = {};
    }
  }
  const fromExif = Boolean(info.takenAt);
  if (!info.takenAt && file.lastModified) info.takenAt = localIso(new Date(file.lastModified));
  return { ...info, fromExif };
}

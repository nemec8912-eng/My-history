/**
 * Дата съёмки видео из файла MP4/MOV (атом mvhd). Без неё видео из галереи iPhone получали бы дату «сегодня»:
 * у выбранных файлов время изменения — момент выбора.
 */
import { localIso } from "./exif";

async function view(f: Blob, start: number, end: number) {
  return new DataView(await f.slice(start, end).arrayBuffer());
}

/** Ищет атом по пути (например, moov → mvhd), читая только заголовки. */
async function findBox(f: Blob, from: number, to: number, type: string): Promise<{ start: number; size: number; header: number } | null> {
  let p = from;
  while (p + 8 <= to) {
    const h = await view(f, p, p + 16);
    let size = h.getUint32(0);
    const t = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    let header = 8;
    if (size === 1 && h.byteLength >= 16) {
      size = Number(h.getBigUint64(8));
      header = 16;
    } else if (size === 0) size = to - p;
    if (size < header) return null;
    if (t === type) return { start: p, size, header };
    p += size;
  }
  return null;
}

export async function mp4CreationDate(f: Blob): Promise<string | undefined> {
  try {
    const moov = await findBox(f, 0, f.size, "moov");
    if (!moov) return undefined;
    const mvhd = await findBox(f, moov.start + moov.header, moov.start + moov.size, "mvhd");
    if (!mvhd) return undefined;
    const v = await view(f, mvhd.start + mvhd.header, mvhd.start + mvhd.header + 20);
    const version = v.getUint8(0);
    const secs = version === 1 ? Number(v.getBigUint64(4)) : v.getUint32(4);
    if (!secs) return undefined;
    const ms = (secs - 2082844800) * 1000; // от 1904-01-01 к 1970-01-01
    if (ms < Date.UTC(1995, 0, 1) || ms > Date.now() + 86_400_000) return undefined;
    return localIso(new Date(ms));
  } catch {
    return undefined;
  }
}

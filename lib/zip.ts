/**
 * Чтение ZIP-архивов прямо в браузере (в том числе больших архивов Google Takeout, ZIP64).
 * Файл не загружается в память целиком: читаются только оглавление и нужные файлы.
 */
export type ZipEntry = { name: string; size: number; compSize: number; method: number; offset: number };

const td = new TextDecoder();

async function bytes(file: Blob, start: number, end: number) {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

export async function listZip(file: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(file.size, 66_000);
  const tail = await bytes(file, file.size - tailLen, file.size);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Это не ZIP-архив");
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  // ZIP64: ищем «локатор» перед EOCD.
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const recOffset = Number(tail.getBigUint64(eocd - 20 + 8, true));
    const rec = await bytes(file, recOffset, recOffset + 56);
    if (rec.getUint32(0, true) === 0x06064b50) {
      count = Number(rec.getBigUint64(32, true));
      cdSize = Number(rec.getBigUint64(40, true));
      cdOffset = Number(rec.getBigUint64(48, true));
    }
  }
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = td.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 extra: значения идут по порядку только для полей, равных 0xFFFFFFFF.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) (size = Number(cd.getBigUint64(q, true))), (q += 8);
        if (compSize === 0xffffffff) (compSize = Number(cd.getBigUint64(q, true))), (q += 8);
        if (offset === 0xffffffff) offset = Number(cd.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    if (!name.endsWith("/")) out.push({ name, size, compSize, method, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function readZipEntry(file: Blob, e: ZipEntry, type = ""): Promise<Blob> {
  const h = await bytes(file, e.offset, e.offset + 30);
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error("Повреждённый ZIP");
  const start = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const raw = file.slice(start, start + e.compSize);
  if (e.method === 0) return new Blob([raw], { type });
  if (e.method !== 8) throw new Error("Неподдерживаемое сжатие в ZIP");
  if (typeof DecompressionStream === "undefined") throw new Error("Браузер не умеет распаковывать ZIP — распакуйте архив и выберите папку или файлы");
  const stream = raw.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = await new Response(stream).blob();
  return type ? new Blob([out], { type }) : out;
}

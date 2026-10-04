/** Отдать файл пользователю: на телефоне — через «Поделиться» (сохранить в Файлы, отправить), иначе — скачивание. */
export async function saveFile(blob: Blob, name: string, opts: { share?: boolean; title?: string } = {}): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  if ((opts.share || mobile) && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.title ?? name });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // иначе — пробуем обычное скачивание
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}

export const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

/** Уменьшает фото до maxSide и возвращает JPEG. */
export async function shrinkImage(url: string, maxSide: number, quality = 0.82): Promise<Blob | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", quality));
  } catch {
    return null;
  }
}

export const today = () => new Date().toISOString().slice(0, 10);

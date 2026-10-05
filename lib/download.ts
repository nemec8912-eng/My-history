type PendingSave = { blob: Blob; name: string; title?: string };
const saveListeners = new Set<(p: PendingSave | null) => void>();
/** Для окна «Файл готов»: iPhone разрешает «Поделиться» только сразу после нажатия. */
export function onPendingSave(fn: (p: PendingSave | null) => void): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

function shareFile(blob: Blob, name: string) {
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Отдать файл пользователю: на телефоне — через «Поделиться» (сохранить в Файлы, отправить), иначе — скачивание.
 * Если файл готовился долго и браузер уже не считает это ответом на нажатие (iPhone), показываем кнопку «Сохранить».
 */
export async function saveFile(blob: Blob, name: string, opts: { share?: boolean; title?: string } = {}): Promise<"shared" | "downloaded" | "cancelled" | "prompted"> {
  const file = shareFile(blob, name);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  if ((opts.share || mobile) && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.title ?? name });
      return "shared";
    } catch (e) {
      const n = (e as Error)?.name;
      if (n === "AbortError") return "cancelled";
      if (n === "NotAllowedError") {
        saveListeners.forEach((l) => l({ blob, name, title: opts.title }));
        return "prompted";
      }
      // иначе — обычное скачивание
    }
  }
  download(blob, name);
  return "downloaded";
}

/** Вызывается из кнопки окна «Файл готов» — это свежее нажатие, «Поделиться» разрешено. */
export async function saveFileNow(p: PendingSave) {
  const file = shareFile(p.blob, p.name);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: p.title ?? p.name });
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
    }
  }
  download(p.blob, p.name);
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

export { localToday as today } from "./format";

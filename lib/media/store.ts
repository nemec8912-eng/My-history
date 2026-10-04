/**
 * Абстракция медиахранилища.
 *
 * Записи приложения ссылаются только на внутренний mediaId. Где физически лежит
 * файл (локальный кэш IndexedDB, Supabase Storage, в будущем Google Drive),
 * определяется отдельной таблицей media_storage (provider + location).
 * Поэтому хранилище можно перенести, не трогая поездки и точки.
 */
import { newId } from "../markerStyle";
import { getSupabase, getUserId, MEDIA_BUCKET } from "../supabase";
import type { MediaId, MediaItem, MediaKind } from "../types";
import { idb, STORES } from "./idb";
import { readPhotoInfo } from "../exif";
import { downloadFromDrive, getDriveToken, isDriveEnabled, onDriveChange, uploadToDrive } from "./gdrive";

export type Variant = "original" | "thumb";

const MAX_SIDE = 2560;
const THUMB_SIDE = 480;
const PENDING_KEY = "pending-uploads";
const PENDING_DRIVE = "pending-drive";

const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function kindOf(mime: string): MediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "image";
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    img.src = url;
  });
}

function resize(img: HTMLImageElement, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas недоступен"));
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сжать фото"))), "image/jpeg", quality)
  );
}

async function processImage(file: File) {
  const img = await loadImage(file);
  const full = file.size > 1.5 * 1024 * 1024 || Math.max(img.naturalWidth, img.naturalHeight) > MAX_SIDE
    ? await resize(img, MAX_SIDE, 0.86)
    : file;
  const thumb = await resize(img, THUMB_SIDE, 0.8);
  return { full, thumb, width: img.naturalWidth, height: img.naturalHeight };
}

/** Кадр-обложка видео (для быстрых плиток без загрузки всего ролика). */
function videoPoster(file: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let done = false;
    const finish = (b: Blob | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(b);
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.6, (v.duration || 1) / 3);
    };
    v.onseeked = () => {
      const scale = Math.min(1, THUMB_SIDE / Math.max(v.videoWidth || 1, v.videoHeight || 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round((v.videoWidth || THUMB_SIDE) * scale));
      c.height = Math.max(1, Math.round((v.videoHeight || THUMB_SIDE) * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return finish(null);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        clearTimeout(timer);
        finish(b);
      }, "image/jpeg", 0.8);
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    v.src = url;
    v.load();
  });
}

/** Длительность видео или аудио (сек), если браузер может её прочитать. */
function mediaDuration(file: Blob, kind: MediaKind): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    const done = (d?: number) => {
      URL.revokeObjectURL(url);
      resolve(d && Number.isFinite(d) ? Math.round(d) : undefined);
    };
    const t = setTimeout(() => done(), 6000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      clearTimeout(t);
      done(el.duration);
    };
    el.onerror = () => {
      clearTimeout(t);
      done();
    };
    el.src = url;
  });
}

type StoredBuffer = { __buf: ArrayBuffer; type: string };

/**
 * Сохраняет файл в IndexedDB. Safari в приватном режиме (и иногда с объектами File из выбора файлов)
 * не умеет хранить Blob («Error preparing Blob/File data…») — тогда храним содержимое как ArrayBuffer.
 */
async function putBlob(key: string, blob: Blob) {
  try {
    await idb.set(STORES.blobs, key, blob);
  } catch {
    const stored: StoredBuffer = { __buf: await blob.arrayBuffer(), type: blob.type };
    await idb.set(STORES.blobs, key, stored);
  }
}

async function getBlob(key: string): Promise<Blob | undefined> {
  const v = await idb.get<Blob | StoredBuffer>(STORES.blobs, key).catch(() => undefined);
  if (!v) return undefined;
  if (v instanceof Blob) return v;
  if ("__buf" in v) return new Blob([v.__buf], { type: v.type });
  return undefined;
}

/* ───────────── Облако (Supabase Storage как первый провайдер) ───────────── */

async function getPending(): Promise<MediaId[]> {
  return (await idb.get<MediaId[]>(STORES.kv, PENDING_KEY).catch(() => undefined)) ?? [];
}

async function setPending(ids: MediaId[]) {
  await idb.set(STORES.kv, PENDING_KEY, Array.from(new Set(ids))).catch(() => undefined);
}

export async function queueUpload(ids: MediaId[]) {
  await setPending([...(await getPending()), ...ids]);
}

async function getPendingDrive(): Promise<MediaId[]> {
  return (await idb.get<MediaId[]>(STORES.kv, PENDING_DRIVE).catch(() => undefined)) ?? [];
}
async function setPendingDrive(ids: MediaId[]) {
  await idb.set(STORES.kv, PENDING_DRIVE, Array.from(new Set(ids))).catch(() => undefined);
}

/** Сколько файлов ждут загрузки в облако (Supabase). */
export async function pendingUploadCount(): Promise<number> {
  return (await getPending()).length;
}

/** Сколько оригиналов ждут загрузки на Google Диск. */
export async function pendingDriveCount(): Promise<number> {
  return (await getPendingDrive()).length;
}

const syncListeners = new Set<() => void>();
export function onSyncChange(fn: () => void): () => void {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}
const emitSync = () => syncListeners.forEach((fn) => fn());

/** Загружает оригиналы на Google Диск и записывает, где они лежат (media_storage). */
async function syncDrive(userId: string) {
  if (!getDriveToken()) return;
  const sb = getSupabase();
  if (!sb) return;
  const pending = await getPendingDrive();
  const left: MediaId[] = [];
  for (const id of pending) {
    try {
      const raw = await getBlob(`${id}:raw`);
      const meta = await idb.get<MediaItem>(STORES.meta, id);
      if (!raw || !meta) continue;
      const ext = (meta.name?.split(".").pop() || meta.mime.split("/")[1] || "bin").slice(0, 5);
      const stamp = meta.createdAt.slice(0, 19).replace(/[T:]/g, "-");
      const { fileId, size } = await uploadToDrive(raw, `${stamp}_${id.slice(0, 8)}.${ext}`, raw.type || meta.mime, { mediaId: id });
      const { error } = await sb.from("media_storage").upsert(
        {
          media_id: id,
          variant: "original",
          owner_id: userId,
          provider: "gdrive",
          location: { fileId },
          size,
          status: "ok",
        },
        { onConflict: "media_id,variant,provider" }
      );
      if (error) throw error;
      // Освобождаем место на телефоне: фото остаются в виде облегчённой копии, большие файлы — на Диске.
      if (meta.kind === "image" || raw.size > 20 * 1024 * 1024) await idb.del(STORES.blobs, `${id}:raw`).catch(() => undefined);
      emitSync();
    } catch (e) {
      if (e instanceof Error && e.message === "NO_TOKEN") {
        left.push(id);
        continue;
      }
      console.warn("Не удалось загрузить на Google Диск", id, e);
      left.push(id);
    }
  }
  const now = await getPendingDrive();
  await setPendingDrive([...left, ...now.filter((id) => !pending.includes(id))]);
  emitSync();
}

if (typeof window !== "undefined") {
  onDriveChange(() => {
    if (getDriveToken()) void syncPendingUploads();
  });
}

async function uploadOne(id: MediaId, userId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const meta = await idb.get<MediaItem>(STORES.meta, id);
  if (!meta) return true; // нечего загружать
  const { error: metaError } = await sb.from("media").upsert({
    id: meta.id,
    owner_id: userId,
    kind: meta.kind,
    mime: meta.mime,
    name: meta.name ?? null,
    size: meta.size,
    width: meta.width ?? null,
    height: meta.height ?? null,
    created_at: meta.createdAt,
  });
  if (metaError) throw metaError;

  // Если оригинал уходит на Google Диск, в Supabase кладём только превью.
  const variants: Variant[] = meta.drive ? ["thumb"] : ["original", "thumb"];
  for (const variant of variants) {
    const blob = await getBlob(`${id}:${variant}`);
    if (!blob) continue;
    const path = `${userId}/${id}/${variant}`;
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, {
      upsert: true,
      contentType: blob.type || meta.mime,
    });
    if (error) throw error;
    const { error: mapError } = await sb.from("media_storage").upsert(
      {
        media_id: id,
        variant,
        owner_id: userId,
        provider: "supabase",
        location: { bucket: MEDIA_BUCKET, path },
        size: blob.size,
        status: "ok",
      },
      { onConflict: "media_id,variant,provider" }
    );
    if (mapError) throw mapError;
  }
  return true;
}

let syncing: Promise<void> | null = null;

/** Догружает в облако всё, что было сохранено офлайн или до входа в аккаунт. */
export function syncPendingUploads(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    const userId = await getUserId();
    if (!userId) return;
    const pending = await getPending();
    const left: MediaId[] = [];
    for (const id of pending) {
      try {
        await uploadOne(id, userId);
      } catch (e) {
        console.warn("Не удалось загрузить медиа", id, e);
        left.push(id);
      }
    }
    // Учитываем файлы, добавленные во время синхронизации.
    const now = await getPending();
    await setPending([...left, ...now.filter((id) => !pending.includes(id))]);
    await syncDrive(userId).catch((e) => console.warn("Google Диск", e));
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function downloadFromCloud(id: MediaId, variant: Variant): Promise<Blob | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: rows } = await sb
    .from("media_storage")
    .select("variant, provider, location, status")
    .eq("media_id", id)
    .eq("status", "ok");
  if (!rows?.length) return null;
  const row =
    rows.find((r) => r.variant === variant && r.provider === "supabase") ??
    rows.find((r) => r.variant === variant) ??
    rows.find((r) => r.variant === "original") ??
    rows[0];
  if (row.provider === "gdrive") {
    const loc = row.location as { fileId: string };
    const blob = await downloadFromDrive(loc.fileId);
    if (blob && blob.size < 8 * 1024 * 1024) await putBlob(`${id}:original`, blob).catch(() => undefined);
    return blob;
  }
  if (row.provider === "supabase") {
    const loc = row.location as { bucket: string; path: string };
    const { data } = await sb.storage.from(loc.bucket).download(loc.path);
    if (data) await putBlob(`${id}:${row.variant}`, data).catch(() => undefined);
    return data ?? null;
  }
  return null;
}

async function downloadMeta(id: MediaId): Promise<MediaItem | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("media").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const meta: MediaItem = {
    id: data.id,
    kind: data.kind,
    mime: data.mime,
    name: data.name ?? undefined,
    size: data.size,
    width: data.width ?? undefined,
    height: data.height ?? undefined,
    createdAt: data.created_at,
  };
  await idb.set(STORES.meta, id, meta).catch(() => undefined);
  return meta;
}

/* ───────────── Публичный API ───────────── */

export async function addMedia(file: File): Promise<MediaItem> {
  const id = newId();
  const mime = file.type || "application/octet-stream";
  const kind = kindOf(mime);
  let original: Blob = file;
  let thumb: Blob | null = null;
  let width: number | undefined;
  let height: number | undefined;

  if (kind === "video") thumb = await videoPoster(file).catch(() => null);
  const duration = kind === "image" ? undefined : await mediaDuration(file, kind).catch(() => undefined);
  if (kind === "image") {
    try {
      const p = await processImage(file);
      original = p.full;
      thumb = p.thumb;
      width = p.width;
      height = p.height;
    } catch {
      // Формат, который браузер не умеет декодировать: храним как есть.
    }
  }

  // Дата и место съёмки из EXIF — до сжатия, иначе они теряются.
  const shot = kind === "image" ? await readPhotoInfo(file).catch(() => null) : null;

  const drive = isDriveEnabled();
  if (drive) {
    // Оригинал без сжатия — на Google Диск; на телефоне остаётся облегчённая копия фото.
    await putBlob(`${id}:raw`, file);
    if (kind === "image") await putBlob(`${id}:original`, original);
  } else {
    await putBlob(`${id}:original`, original);
  }
  if (thumb) await putBlob(`${id}:thumb`, thumb);

  const meta: MediaItem = {
    id,
    kind,
    mime: original.type || mime,
    name: file.name,
    size: original.size,
    width,
    height,
    createdAt: new Date().toISOString(),
    ...(duration ? { duration } : {}),
    ...(drive ? { drive: true } : {}),
    ...(shot?.fromExif && shot.takenAt ? { takenAt: shot.takenAt } : {}),
    ...(shot?.gps ? { gps: shot.gps } : {}),
  };
  await idb.set(STORES.meta, id, meta);
  await queueUpload([id]);
  if (drive) await setPendingDrive([...(await getPendingDrive()), id]);
  emitSync();
  void syncPendingUploads();
  return meta;
}

export async function addMediaFiles(files: File[]): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  for (const f of files) out.push(await addMedia(f));
  return out;
}

export async function addMediaFromDataUrl(dataUrl: string): Promise<MediaItem | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return addMedia(new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
  } catch {
    return null;
  }
}

export async function getMediaMeta(id: MediaId): Promise<MediaItem | null> {
  const local = await idb.get<MediaItem>(STORES.meta, id).catch(() => undefined);
  return local ?? (await downloadMeta(id).catch(() => null));
}

export function getMediaUrl(id: MediaId, variant: Variant = "thumb"): Promise<string | null> {
  const key = `${id}:${variant}`;
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;

  const p = (async () => {
    let blob =
      (await getBlob(key)) ??
      (variant === "original" ? await getBlob(`${id}:raw`) : undefined) ??
      (variant === "thumb" && (await idb.get<MediaItem>(STORES.meta, id).catch(() => undefined))?.kind !== "video"
        ? await getBlob(`${id}:original`)
        : undefined) ??
      null;
    if (!blob) blob = await downloadFromCloud(id, variant).catch(() => null);
    if (!blob && variant === "original") {
      // Оригинал недоступен (например, Google Диск не подключён на этом устройстве) — показываем превью.
      return getMediaUrl(id, "thumb");
    }
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

export async function listLocalMediaIds(): Promise<MediaId[]> {
  return ((await idb.keys(STORES.meta).catch(() => [])) as string[]) ?? [];
}

/** Восстановление из архива: метаданные и превью файла, если на устройстве их ещё нет. */
export async function importMediaPreview(meta: MediaItem, thumb?: Blob): Promise<boolean> {
  const has = await idb.get<MediaItem>(STORES.meta, meta.id).catch(() => undefined);
  if (has) return false;
  await idb.set(STORES.meta, meta.id, { ...meta, drive: undefined });
  if (thumb) await putBlob(`${meta.id}:thumb`, thumb);
  return true;
}

/** Удаляет локальную копию файла (метаданные и все варианты) с устройства. */
export async function forgetLocalMedia(id: MediaId) {
  await idb.del(STORES.meta, id).catch(() => undefined);
  for (const v of ["original", "thumb", "raw"]) await idb.del(STORES.blobs, `${id}:${v}`).catch(() => undefined);
  for (const v of ["original", "thumb"]) {
    const u = urlCache.get(`${id}:${v}`);
    if (u) URL.revokeObjectURL(u);
    urlCache.delete(`${id}:${v}`);
  }
}

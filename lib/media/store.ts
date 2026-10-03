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

export type Variant = "original" | "thumb";

const MAX_SIDE = 2560;
const THUMB_SIDE = 480;
const PENDING_KEY = "pending-uploads";

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

  for (const variant of ["original", "thumb"] as Variant[]) {
    const blob = await idb.get<Blob>(STORES.blobs, `${id}:${variant}`);
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
  const row = rows.find((r) => r.variant === variant) ?? rows.find((r) => r.variant === "original") ?? rows[0];
  if (row.provider === "supabase") {
    const loc = row.location as { bucket: string; path: string };
    const { data } = await sb.storage.from(loc.bucket).download(loc.path);
    if (data) await idb.set(STORES.blobs, `${id}:${row.variant}`, data).catch(() => undefined);
    return data ?? null;
  }
  // Здесь появится провайдер "gdrive": location = { accountId, fileId }.
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

  await idb.set(STORES.blobs, `${id}:original`, original);
  if (thumb) await idb.set(STORES.blobs, `${id}:thumb`, thumb);

  const meta: MediaItem = {
    id,
    kind,
    mime: original.type || mime,
    name: file.name,
    size: original.size,
    width,
    height,
    createdAt: new Date().toISOString(),
  };
  await idb.set(STORES.meta, id, meta);
  await queueUpload([id]);
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
      (await idb.get<Blob>(STORES.blobs, key).catch(() => undefined)) ??
      (variant === "thumb" ? await idb.get<Blob>(STORES.blobs, `${id}:original`).catch(() => undefined) : undefined) ??
      null;
    if (!blob) blob = await downloadFromCloud(id, variant).catch(() => null);
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

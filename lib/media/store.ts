/**
 * Абстракция медиахранилища.
 *
 * Записи приложения ссылаются только на внутренний mediaId. Где физически лежит
 * файл (локальный кэш IndexedDB, Supabase Storage, в будущем Google Drive),
 * определяется отдельной таблицей media_storage (provider + location).
 * Поэтому хранилище можно перенести, не трогая поездки и точки.
 */
import { newId } from "../markerStyle";
import { getSupabase, getUserId, isCloudConfigured, MEDIA_BUCKET } from "../supabase";
import type { MediaId, MediaItem, MediaKind } from "../types";
import { idb, STORES } from "./idb";
import {
  createDriveSession,
  downloadFromDrive,
  DRIVE_EXPIRED_MESSAGE,
  getDriveToken,
  isDriveEnabled,
  onDriveChange,
  uploadToDrive,
} from "./gdrive";
import { resumableUpload, SessionExpiredError, UploadFailedError, waitOnlineBrowser, xhrTransport, type DriveFile } from "./driveUpload";
import { getUpload, isActive, listUploads, setUpload } from "./uploadState";
import { mark, takePickerDelay } from "./timing";

export type Variant = "original" | "thumb";

const MAX_SIDE = 2560;
const THUMB_SIDE = 480;
const PENDING_KEY = "pending-uploads";
const PENDING_DRIVE = "pending-drive";

const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

const VIDEO_EXT = /\.(mov|mp4|m4v|3gp|3g2|webm|mkv|avi|hevc)$/i;

function kindOf(mime: string, name = ""): MediaKind {
  if (mime.startsWith("video/")) return "video";
  // Некоторые браузеры отдают пустой type — определяем видео по расширению.
  if ((!mime || mime === "application/octet-stream") && VIDEO_EXT.test(name)) return "video";
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

type VideoInfo = { poster: Blob | null; duration?: number; width?: number; height?: number };

/**
 * Кадр-обложка и длительность видео за один проход одним элементом <video>.
 * preload="metadata": браузер читает только заголовок файла и кадр в точке перемотки,
 * а не весь ролик. Выполняется в фоне и не задерживает начало загрузки.
 */
function videoInfo(file: Blob): Promise<VideoInfo> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const info: VideoInfo = { poster: null };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(nudge);
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = setTimeout(finish, 15000);
    let nudge: ReturnType<typeof setTimeout> | undefined;
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) info.duration = Math.round(v.duration);
      info.width = v.videoWidth || undefined;
      info.height = v.videoHeight || undefined;
      v.currentTime = Math.min(0.6, (v.duration || 1) / 3);
      // Если Safari не отдаёт кадр без воспроизведения — коротко «толкаем» видео (без звука).
      nudge = setTimeout(() => {
        v.play()
          .then(() => v.pause())
          .catch(() => undefined);
      }, 3000);
    };
    v.onseeked = () => {
      const scale = Math.min(1, THUMB_SIDE / Math.max(v.videoWidth || 1, v.videoHeight || 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round((v.videoWidth || THUMB_SIDE) * scale));
      c.height = Math.max(1, Math.round((v.videoHeight || THUMB_SIDE) * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return finish();
      try {
        ctx.drawImage(v, 0, 0, c.width, c.height);
      } catch {
        return finish();
      }
      c.toBlob((b) => {
        info.poster = b;
        finish();
      }, "image/jpeg", 0.8);
    };
    v.onerror = finish;
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

/* ───────────── Видео: отдельный быстрый путь ─────────────
 *
 * Видео не копируется в IndexedDB перед отправкой: загрузка идёт прямо из выбранного
 * файла (File в памяти вкладки — это ссылка на файл на диске, а не его содержимое).
 * Копия в IndexedDB делается параллельно и нужна только на случай перезапуска
 * приложения до окончания загрузки. После успешной загрузки большая копия удаляется.
 */

/** Исходные файлы видео, выбранные в этой вкладке (до завершения загрузки). */
const memFiles = new Map<MediaId, Blob>();
/** Фоновое сохранение копии видео в IndexedDB: true — копия на диске. */
const localWrites = new Map<MediaId, Promise<boolean>>();

const mediaListeners = new Set<(id: MediaId) => void>();
/** Метаданные или превью файла обновились (например, появилась обложка видео). */
export function onMediaChange(fn: (id: MediaId) => void): () => void {
  mediaListeners.add(fn);
  return () => mediaListeners.delete(fn);
}
const emitMedia = (id: MediaId) => mediaListeners.forEach((fn) => fn(id));

const SESSION_PREFIX = "drive-session:";
/** Сессия Google живёт около недели; берём с запасом. */
const SESSION_TTL = 6 * 24 * 3600 * 1000;
type StoredSession = { url: string; size: number; createdAt: number };

async function videoSource(id: MediaId): Promise<Blob | undefined> {
  return memFiles.get(id) ?? (await idb.get<Blob>(STORES.blobs, `${id}:raw`).catch(() => undefined));
}

async function getSession(id: MediaId, size: number): Promise<StoredSession | undefined> {
  const s = await idb.get<StoredSession>(STORES.kv, SESSION_PREFIX + id).catch(() => undefined);
  if (!s || s.size !== size || Date.now() - s.createdAt > SESSION_TTL) return undefined;
  return s;
}

const isNetFail = (e: unknown) => e instanceof TypeError; // fetch: «Load failed» / «Failed to fetch»
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Создание сессии с несколькими попытками при кратковременной потере сети. */
async function createSessionWithRetry(name: string, mime: string, size: number, id: MediaId): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await createDriveSession(name, mime, size, { mediaId: id });
    } catch (e) {
      if (!isNetFail(e) || attempt >= 4) throw e;
      setUpload(id, { phase: "retrying" });
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** Отправляет видео на Google Диск частями; продолжает прерванную сессию, если она есть. */
async function uploadVideo(id: MediaId, meta: MediaItem, src: Blob): Promise<DriveFile> {
  const ext = (meta.name?.split(".").pop() || meta.mime.split("/")[1] || "mp4").slice(0, 5);
  const stamp = meta.createdAt.slice(0, 19).replace(/[T:]/g, "-");
  const name = `${stamp}_${id.slice(0, 8)}.${ext}`;
  const mime = src.type || meta.mime || "video/mp4";
  const size = src.size;
  const prev = getUpload(id);
  setUpload(id, { name: meta.name, phase: "uploading", total: size, loaded: prev?.total === size ? prev.loaded : 0 });

  let session = await getSession(id, size);
  for (let round = 0; ; round++) {
    let fresh = false;
    if (!session) {
      if (!getDriveToken()) throw new Error("NO_TOKEN");
      mark(id, "создание сессии Google Drive");
      const url = await createSessionWithRetry(name, mime, size, id);
      session = { url, size, createdAt: Date.now() };
      await idb.set(STORES.kv, SESSION_PREFIX + id, session).catch(() => undefined);
      fresh = true;
      mark(id, "сессия создана");
    } else {
      mark(id, "продолжение прерванной сессии");
    }
    let started = false;
    try {
      const file = await resumableUpload({
        sessionUrl: session.url,
        size,
        mime,
        fresh,
        transport: xhrTransport(),
        getSource: async () => {
          const b = await videoSource(id);
          if (!b) throw new UploadFailedError("Файл видео больше недоступен на этом устройстве");
          return b;
        },
        isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
        waitOnline: waitOnlineBrowser,
        onProgress: (p) => {
          if (!started && p.phase === "uploading") {
            started = true;
            mark(id, "передача данных", `с ${Math.round(p.loaded / 1024)} КБ из ${Math.round(p.total / 1024)} КБ`);
          }
          setUpload(id, { phase: p.phase, loaded: p.loaded, total: p.total, indeterminate: false });
        },
      });
      mark(id, "передача завершена");
      return file;
    } catch (e) {
      if (e instanceof SessionExpiredError && round === 0) {
        // Сессия истекла (прошла неделя) — начинаем новую, уже без старого прогресса.
        await idb.del(STORES.kv, SESSION_PREFIX + id).catch(() => undefined);
        session = undefined;
        setUpload(id, { loaded: 0 });
        continue;
      }
      throw e;
    }
  }
}

/** Понятное пользователю состояние после ошибки загрузки видео. */
function videoFailed(id: MediaId, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "NO_TOKEN" || msg === DRIVE_EXPIRED_MESSAGE) {
    setUpload(id, { phase: "waiting-auth", message: "Нужно снова подключить Google Диск — загрузка продолжится с того же места" });
  } else {
    setUpload(id, { phase: "error", message: "Не удалось загрузить видео" });
  }
}

/** Загружает оригиналы на Google Диск и записывает, где они лежат (media_storage). */
async function syncDrive(userId: string) {
  const sb = getSupabase();
  if (!sb) return;
  const hasToken = Boolean(getDriveToken());
  const pending = await getPendingDrive();
  const left: MediaId[] = [];
  for (const id of pending) {
    try {
      const meta = await idb.get<MediaItem>(STORES.meta, id);
      if (meta?.kind === "video") {
        if (!(await syncDriveVideo(id, meta, userId))) left.push(id);
        continue;
      }
      if (!hasToken) {
        left.push(id);
        continue;
      }
      const raw = await idb.get<Blob>(STORES.blobs, `${id}:raw`);
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

/** Видео → Google Диск. true — готово (или загружать нечего), false — оставить в очереди. */
async function syncDriveVideo(id: MediaId, meta: MediaItem, userId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const src = await videoSource(id);
  if (!src) {
    // Копии нет ни в памяти, ни на телефоне — продолжить невозможно.
    console.warn("Видео недоступно для загрузки", id);
    if (getUpload(id)) setUpload(id, { phase: "error", message: "Файл видео не найден на этом устройстве" });
    return true;
  }
  // Без токена можно только продолжить уже созданную сессию.
  if (!getDriveToken() && !(await getSession(id, src.size))) {
    videoFailed(id, new Error("NO_TOKEN"));
    return false;
  }
  try {
    const { id: fileId, size } = await uploadVideo(id, meta, src);
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
    // Сессию удаляем только после записи в media_storage: если запись не прошла,
    // следующая попытка узнает у Google, что файл уже принят, и не отправит его повторно.
    await idb.del(STORES.kv, SESSION_PREFIX + id).catch(() => undefined);
    // Дожидаемся фоновой копии, чтобы она не «воскресла» после удаления.
    await localWrites.get(id)?.catch(() => false);
    if (src.size > 20 * 1024 * 1024) await idb.del(STORES.blobs, `${id}:raw`).catch(() => undefined);
    memFiles.delete(id);
    localWrites.delete(id);
    setUpload(id, { phase: "done", loaded: size, total: size, savedLocally: true });
    mark(id, "готово");
    emitSync();
    return true;
  } catch (e) {
    console.warn("Не удалось загрузить видео на Google Диск", id, e);
    videoFailed(id, e);
    return false;
  }
}

/** Повторить загрузку видео: продолжает с места, которое подтвердил Google Диск. */
export function retryUpload(id: MediaId): Promise<void> {
  const s = getUpload(id);
  if (s) setUpload(id, { phase: "queued" });
  return syncPendingUploads();
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
    let blob = await idb.get<Blob>(STORES.blobs, `${id}:${variant}`);
    // Видео без Google Диска: копия на телефоне может ещё записываться — берём исходный файл.
    const videoOriginal = meta.kind === "video" && variant === "original";
    if (!blob && videoOriginal) blob = memFiles.get(id);
    if (!blob) continue;
    if (videoOriginal) setUpload(id, { phase: "uploading", total: blob.size, indeterminate: true });
    const path = `${userId}/${id}/${variant}`;
    try {
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
    } catch (e) {
      if (videoOriginal) setUpload(id, { phase: "error", message: "Не удалось загрузить видео" });
      throw e;
    }
    if (videoOriginal) {
      setUpload(id, { phase: "done", loaded: blob.size, indeterminate: false });
      memFiles.delete(id);
    }
  }
  return true;
}

let syncing: Promise<void> | null = null;
let syncAgain = false;

/** Догружает в облако всё, что было сохранено офлайн или до входа в аккаунт. */
export function syncPendingUploads(): Promise<void> {
  // Если синхронизация уже идёт, файлы, добавленные сейчас, обработаются сразу после неё
  // (раньше они ждали следующего запуска приложения или появления сети).
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = (async () => {
    for (let round = 0; round < 5; round++) {
      syncAgain = false;
      await syncOnce();
      if (!syncAgain) break;
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function syncOnce() {
  const userId = await getUserId();
  if (!userId) {
    if (isCloudConfigured()) {
      listUploads()
        .filter((s) => isActive(s))
        .forEach((s) => setUpload(s.id, { phase: "waiting-account", message: "Видео сохранено на телефоне. Загрузка начнётся после входа в аккаунт" }));
    }
    return;
  }
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
}

async function downloadFromCloud(id: MediaId, variant: Variant, isVideo = false): Promise<Blob | null> {
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
  // Ради обложки видео не скачиваем с Диска весь ролик.
  if (isVideo && variant === "thumb" && row.variant !== "thumb") return null;
  if (row.provider === "gdrive") {
    const loc = row.location as { fileId: string };
    const blob = await downloadFromDrive(loc.fileId);
    if (blob && blob.size < 8 * 1024 * 1024) await idb.set(STORES.blobs, `${id}:original`, blob).catch(() => undefined);
    return blob;
  }
  if (row.provider === "supabase") {
    const loc = row.location as { bucket: string; path: string };
    const { data } = await sb.storage.from(loc.bucket).download(loc.path);
    if (data) await idb.set(STORES.blobs, `${id}:${row.variant}`, data).catch(() => undefined);
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
  const kind = kindOf(mime, file.name);
  if (kind === "video") return addVideo(file, id, mime === "application/octet-stream" ? guessVideoMime(file.name) : mime);
  let original: Blob = file;
  let thumb: Blob | null = null;
  let width: number | undefined;
  let height: number | undefined;

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

  const drive = isDriveEnabled();
  if (drive) {
    // Оригинал без сжатия — на Google Диск; на телефоне остаётся облегчённая копия фото.
    await idb.set(STORES.blobs, `${id}:raw`, file);
    if (kind === "image") await idb.set(STORES.blobs, `${id}:original`, original);
  } else {
    await idb.set(STORES.blobs, `${id}:original`, original);
  }
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
    ...(duration ? { duration } : {}),
    ...(drive ? { drive: true } : {}),
  };
  await idb.set(STORES.meta, id, meta);
  await queueUpload([id]);
  if (drive) await setPendingDrive([...(await getPendingDrive()), id]);
  emitSync();
  void syncPendingUploads();
  return meta;
}

function guessVideoMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4";
}

/**
 * Быстрый путь для видео: метаданные сохраняются сразу (миллисекунды), загрузка
 * стартует немедленно прямо из выбранного файла. Обложка, длительность и резервная
 * копия на телефоне делаются параллельно и не задерживают ни интерфейс, ни передачу.
 */
async function addVideo(file: File, id: MediaId, mime: string): Promise<MediaItem> {
  const pickerDelay = takePickerDelay();
  mark(id, "файл получен", `${(file.size / 1024 / 1024).toFixed(1)} МБ${pickerDelay != null ? `, выбор в системном окне ${Math.round(pickerDelay)} мс` : ""}`);
  setUpload(id, { name: file.name, phase: "preparing", loaded: 0, total: file.size });
  const drive = isDriveEnabled();
  const meta: MediaItem = {
    id,
    kind: "video",
    mime,
    name: file.name,
    size: file.size,
    createdAt: new Date().toISOString(),
    ...(drive ? { drive: true } : {}),
  };
  memFiles.set(id, file);
  try {
    await idb.set(STORES.meta, id, meta);
  } catch (e) {
    memFiles.delete(id);
    setUpload(id, { phase: "error", message: "Не удалось сохранить видео" });
    throw e;
  }
  mark(id, "метаданные сохранены");
  await queueUpload([id]);
  if (drive) await setPendingDrive([...(await getPendingDrive()), id]);
  setUpload(id, { phase: "queued" });
  mark(id, "в очереди загрузки");

  // Резервная копия на телефоне — параллельно с загрузкой.
  const key = `${id}:${drive ? "raw" : "original"}`;
  const write = idb
    .setDurable(STORES.blobs, key, file)
    .then(() => {
      mark(id, "копия в IndexedDB готова");
      setUpload(id, { savedLocally: true, localFailed: false });
      if (!isCloudConfigured()) setUpload(id, { phase: "done", loaded: file.size, message: "Сохранено на телефоне" });
      return true;
    })
    .catch((e) => {
      mark(id, "копия в IndexedDB не удалась", String(e));
      console.warn("Не удалось сохранить копию видео на телефоне", id, e);
      setUpload(id, { localFailed: true });
      return false;
    });
  localWrites.set(id, write);

  // Обложка и длительность — в фоне.
  void enrichVideo(id, file);

  emitSync();
  void syncPendingUploads();
  return meta;
}

async function enrichVideo(id: MediaId, file: Blob) {
  try {
    const info = await videoInfo(file);
    mark(id, "обложка и длительность", `${info.poster ? "кадр есть" : "без кадра"}, ${info.duration ?? "?"} с`);
    if (info.poster) await idb.set(STORES.blobs, `${id}:thumb`, info.poster);
    const meta = await idb.get<MediaItem>(STORES.meta, id);
    if (meta && (info.duration || info.width)) {
      await idb.set(STORES.meta, id, {
        ...meta,
        ...(info.duration ? { duration: info.duration } : {}),
        ...(info.width ? { width: info.width, height: info.height } : {}),
      });
    }
    emitMedia(id);
    if (info.poster) {
      // Превью уходит в облако отдельным лёгким шагом.
      await queueUpload([id]);
      void syncPendingUploads();
    }
  } catch (e) {
    console.warn("Не удалось получить обложку видео", id, e);
  }
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
    const mem = variant === "original" ? memFiles.get(id) : undefined;
    let blob =
      mem ??
      (await idb.get<Blob>(STORES.blobs, key).catch(() => undefined)) ??
      (variant === "original" ? await idb.get<Blob>(STORES.blobs, `${id}:raw`).catch(() => undefined) : undefined) ??
      (variant === "thumb" && (await idb.get<MediaItem>(STORES.meta, id).catch(() => undefined))?.kind !== "video"
        ? await idb.get<Blob>(STORES.blobs, `${id}:original`).catch(() => undefined)
        : undefined) ??
      null;
    if (!blob) {
      const isVideo = variant === "thumb" && (await idb.get<MediaItem>(STORES.meta, id).catch(() => undefined))?.kind === "video";
      blob = await downloadFromCloud(id, variant, isVideo).catch(() => null);
    }
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

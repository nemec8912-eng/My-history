/**
 * Документы поездки (билеты, брони, чеки). Файл хранится на Google Диске, если он подключён,
 * иначе в облаке Supabase (в своей папке пользователя), без входа — только на устройстве.
 * Копия всегда остаётся на телефоне, поэтому документ открывается и без интернета.
 */
import { newId } from "./markerStyle";
import { idb, STORES } from "./media/idb";
import { deleteFromDrive, downloadFromDrive, getDriveToken, uploadToDrive } from "./media/gdrive";
import { getSupabase, getUserId, MEDIA_BUCKET } from "./supabase";
import type { TripDoc } from "./types";

const key = (id: string) => `doc:${id}`;
type Stored = { buf: ArrayBuffer; type: string };

async function keepLocal(id: string, blob: Blob) {
  const v: Stored = { buf: await blob.arrayBuffer(), type: blob.type };
  await idb.set(STORES.blobs, key(id), v);
}

async function readLocal(id: string): Promise<Blob | null> {
  const v = await idb.get<Stored>(STORES.blobs, key(id)).catch(() => undefined);
  return v ? new Blob([v.buf], { type: v.type }) : null;
}

/** Отправляет в облако документ, который пока есть только на устройстве. */
export async function uploadDoc(doc: TripDoc, blob?: Blob): Promise<TripDoc> {
  const data = blob ?? (await readLocal(doc.id));
  if (!data) return doc;
  if (getDriveToken()) {
    const { fileId } = await uploadToDrive(data, `Документ ${doc.name}`, doc.mime, { docId: doc.id });
    return { ...doc, provider: "gdrive", location: { fileId } };
  }
  const uid = await getUserId();
  const sb = getSupabase();
  if (uid && sb) {
    const path = `${uid}/docs/${doc.id}`;
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, data, { upsert: true, contentType: doc.mime });
    if (error) throw error;
    return { ...doc, provider: "supabase", location: { path } };
  }
  return doc;
}

export async function addDoc(file: File): Promise<TripDoc> {
  const id = newId();
  await keepLocal(id, file);
  const doc: TripDoc = { id, name: file.name, mime: file.type || "application/octet-stream", size: file.size, provider: "local", addedAt: new Date().toISOString() };
  try {
    return await uploadDoc(doc, file);
  } catch {
    return doc; // нет сети — отправится позже
  }
}

export async function getDocBlob(doc: TripDoc): Promise<Blob | null> {
  const local = await readLocal(doc.id);
  if (local) return local;
  let blob: Blob | null = null;
  if (doc.provider === "gdrive" && doc.location?.fileId) blob = await downloadFromDrive(doc.location.fileId).catch(() => null);
  if (!blob && doc.provider === "supabase" && doc.location?.path) {
    const { data } = (await getSupabase()?.storage.from(MEDIA_BUCKET).download(doc.location.path)) ?? { data: null };
    blob = data ?? null;
  }
  if (blob) await keepLocal(doc.id, blob).catch(() => undefined);
  return blob;
}

/** Удаляет документ отовсюду (файл на Google Диске уходит в корзину Диска). */
export async function removeDoc(doc: TripDoc) {
  await idb.del(STORES.blobs, key(doc.id)).catch(() => undefined);
  if (doc.provider === "gdrive" && doc.location?.fileId && getDriveToken()) await deleteFromDrive(doc.location.fileId).catch(() => undefined);
  if (doc.provider === "supabase" && doc.location?.path) await getSupabase()?.storage.from(MEDIA_BUCKET).remove([doc.location.path]);
}

/**
 * Перенос хранилища: оригиналы из Supabase Storage → Google Диск.
 *
 * Порядок по исходному плану:
 *  1) копируем файл; 2) проверяем целостность (размер); 3) добавляем строку
 *     media_storage с provider = "gdrive" — записи дневника по-прежнему ссылаются
 *     на тот же media_id; 4) старые копии удаляются ТОЛЬКО отдельным действием
 *     и только для файлов, у которых есть проверенная копия на Диске.
 */
import { getSupabase, getUserId, MEDIA_BUCKET } from "../supabase";
import { getDriveToken, uploadToDrive } from "./gdrive";

export const SUPABASE_FREE_LIMIT = 1024 ** 3; // 1 ГБ на бесплатном тарифе

type Row = { media_id: string; variant: string; provider: string; location: { bucket?: string; path?: string; fileId?: string }; size: number | null };

async function rows(): Promise<Row[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("media_storage").select("media_id, variant, provider, location, size").eq("status", "ok");
  if (error) throw error;
  return (data ?? []) as Row[];
}

export type StoragePlan = {
  /** Занято в Supabase Storage (оригиналы + превью), байт. */
  supabaseBytes: number;
  /** Оригиналы, которые есть только в Supabase (можно перенести). */
  toMove: Row[];
  toMoveBytes: number;
  /** Оригиналы в Supabase, у которых уже есть проверенная копия на Диске (можно удалить). */
  removable: Row[];
  removableBytes: number;
};

export async function storagePlan(): Promise<StoragePlan> {
  const all = await rows();
  const onDrive = new Set(all.filter((r) => r.provider === "gdrive" && r.variant === "original").map((r) => r.media_id));
  const sbRows = all.filter((r) => r.provider === "supabase");
  const originals = sbRows.filter((r) => r.variant === "original");
  const toMove = originals.filter((r) => !onDrive.has(r.media_id));
  const removable = originals.filter((r) => onDrive.has(r.media_id));
  const sum = (list: Row[]) => list.reduce((s, r) => s + (r.size ?? 0), 0);
  return {
    supabaseBytes: sum(sbRows),
    toMove,
    toMoveBytes: sum(toMove),
    removable,
    removableBytes: sum(removable),
  };
}

/** Копирует оригиналы из Supabase на Google Диск с проверкой размера. */
export async function moveOriginalsToDrive(onProgress: (done: number, total: number) => void): Promise<{ moved: number; failed: number }> {
  const sb = getSupabase();
  const userId = await getUserId();
  if (!sb || !userId) throw new Error("Сначала войдите в аккаунт");
  if (!getDriveToken()) throw new Error("Сначала подключите Google Диск");
  const { toMove } = await storagePlan();
  let moved = 0;
  let failed = 0;
  for (let i = 0; i < toMove.length; i++) {
    const r = toMove[i];
    onProgress(i, toMove.length);
    try {
      const { data: blob, error } = await sb.storage.from(r.location.bucket || MEDIA_BUCKET).download(r.location.path!);
      if (error || !blob) throw error ?? new Error("Файл не найден");
      const { data: meta } = await sb.from("media").select("mime, name, created_at").eq("id", r.media_id).maybeSingle();
      const mime = blob.type || meta?.mime || "application/octet-stream";
      const ext = (meta?.name?.split(".").pop() || mime.split("/")[1] || "bin").slice(0, 5);
      const stamp = String(meta?.created_at ?? new Date().toISOString()).slice(0, 19).replace(/[T:]/g, "-");
      const up = await uploadToDrive(blob, `${stamp}_${r.media_id.slice(0, 8)}.${ext}`, mime, { mediaId: r.media_id });
      // Проверка целостности: размер на Диске совпадает с исходным файлом.
      if (up.size !== blob.size) throw new Error(`Размер не совпал: ${up.size} ≠ ${blob.size}`);
      const { error: mapError } = await sb.from("media_storage").upsert(
        { media_id: r.media_id, variant: "original", owner_id: userId, provider: "gdrive", location: { fileId: up.fileId }, size: up.size, status: "ok" },
        { onConflict: "media_id,variant,provider" }
      );
      if (mapError) throw mapError;
      moved++;
    } catch (e) {
      if (e instanceof Error && e.message === "NO_TOKEN") throw new Error("Доступ к Google Диску истёк — подтвердите вход и продолжите");
      console.warn("Перенос не удался", r.media_id, e);
      failed++;
    }
  }
  onProgress(toMove.length, toMove.length);
  return { moved, failed };
}

/** Удаляет из Supabase оригиналы, у которых есть проверенная копия на Диске. Превью остаются. */
export async function deleteSupabaseCopies(): Promise<{ deleted: number; bytes: number }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Нет связи с облаком");
  const { removable, removableBytes } = await storagePlan();
  if (!removable.length) return { deleted: 0, bytes: 0 };
  const paths = removable.map((r) => r.location.path!).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  for (const r of removable) {
    await sb.from("media_storage").delete().eq("media_id", r.media_id).eq("variant", "original").eq("provider", "supabase");
  }
  return { deleted: removable.length, bytes: removableBytes };
}

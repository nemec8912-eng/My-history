/**
 * Поиск и удаление файлов, которые больше не привязаны ни к одному моменту
 * (например, фото убрали из события). Учитываются и записи в корзине — их файлы не трогаем.
 */
import { getRepo } from "../repo";
import { tripMediaIds } from "../stats";
import { getSupabase, MEDIA_BUCKET } from "../supabase";
import { deleteFromDrive, getDriveToken } from "./gdrive";
import { forgetLocalMedia, listLocalMediaIds, getMediaMeta } from "./store";

export type Orphan = { id: string; size: number; kind: string; createdAt: string; drive: string[]; supabase: string[] };

const HOUR = 3600_000;

export async function findOrphans(): Promise<Orphan[]> {
  const repo = await getRepo();
  const used = new Set([...(await repo.list()), ...(await repo.listTrash())].flatMap(tripMediaIds));
  const out = new Map<string, Orphan>();
  const sb = getSupabase();
  if (sb && repo.mode === "cloud") {
    const { data: media, error } = await sb.from("media").select("id, size, kind, created_at");
    if (error) throw error;
    const { data: rows, error: e2 } = await sb.from("media_storage").select("media_id, provider, location");
    if (e2) throw e2;
    for (const m of media ?? []) {
      // Свежие файлы не трогаем: их могут прямо сейчас добавлять в момент.
      if (used.has(m.id) || Date.now() - new Date(m.created_at).getTime() < HOUR) continue;
      out.set(m.id, { id: m.id, size: m.size ?? 0, kind: m.kind, createdAt: m.created_at, drive: [], supabase: [] });
    }
    for (const r of rows ?? []) {
      const o = out.get(r.media_id);
      if (!o) continue;
      const loc = r.location as { fileId?: string; path?: string };
      if (r.provider === "gdrive" && loc.fileId) o.drive.push(loc.fileId);
      if (r.provider === "supabase" && loc.path) o.supabase.push(loc.path);
    }
  }
  for (const id of await listLocalMediaIds()) {
    if (used.has(id) || out.has(id)) continue;
    const meta = await getMediaMeta(id).catch(() => null);
    if (!meta || Date.now() - new Date(meta.createdAt).getTime() < HOUR) continue;
    out.set(id, { id, size: meta.size, kind: meta.kind, createdAt: meta.createdAt, drive: [], supabase: [] });
  }
  return [...out.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteOrphans(list: Orphan[], onProgress?: (s: string) => void): Promise<{ deleted: number; skipped: number }> {
  const sb = getSupabase();
  const repo = await getRepo();
  // Перепроверяем прямо перед удалением: вдруг файл успели снова добавить в момент.
  const used = new Set([...(await repo.list()), ...(await repo.listTrash())].flatMap(tripMediaIds));
  let deleted = 0;
  let skipped = 0;
  const token = getDriveToken();
  for (const o of list) {
    if (used.has(o.id)) {
      skipped++;
      continue;
    }
    onProgress?.(`Удаляю ${deleted + skipped + 1} из ${list.length}…`);
    if (o.drive.length && !token) {
      skipped++; // без доступа к Диску файл там не удалить — оставляем запись, чтобы удалить позже
      continue;
    }
    try {
      for (const f of o.drive) await deleteFromDrive(f);
      if (sb && o.supabase.length) await sb.storage.from(MEDIA_BUCKET).remove(o.supabase);
      if (sb && repo.mode === "cloud") {
        await sb.from("media_storage").delete().eq("media_id", o.id);
        await sb.from("media").delete().eq("id", o.id);
      }
      await forgetLocalMedia(o.id);
      deleted++;
    } catch (e) {
      console.warn("Не удалось удалить файл", o.id, e);
      skipped++;
    }
  }
  return { deleted, skipped };
}

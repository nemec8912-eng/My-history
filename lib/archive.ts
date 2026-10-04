/**
 * Архив всей истории в одном файле: поездки, события, моменты, метки, места,
 * сведения о файлах (где лежат оригиналы на Google Диске) и, по желанию, превью фото.
 * Из этого файла историю можно восстановить на любом устройстве.
 */
import { blobToDataUrl } from "./download";
import { getMediaMeta, getMediaUrl, importMediaPreview } from "./media/store";
import { getRepo } from "./repo";
import { tripMediaIds } from "./stats";
import { getSupabase } from "./supabase";
import type { MediaItem, Trip } from "./types";

type ArchiveMedia = MediaItem & { storage?: { provider: string; variant: string; location: unknown }[]; thumb?: string };
export type Archive = { app: "my-history"; version: 1; exportedAt: string; trips: Trip[]; media: ArchiveMedia[] };

export async function buildArchive(withPreviews: boolean, onProgress?: (s: string) => void): Promise<Blob> {
  const repo = await getRepo();
  const trips = [...(await repo.list()), ...(await repo.listTrash())];
  const ids = Array.from(new Set(trips.flatMap(tripMediaIds)));
  const storage = new Map<string, ArchiveMedia["storage"]>();
  const sb = getSupabase();
  if (sb && repo.mode === "cloud") {
    const { data } = await sb.from("media_storage").select("media_id, variant, provider, location").eq("status", "ok");
    for (const r of data ?? []) {
      const list = storage.get(r.media_id) ?? [];
      list.push({ provider: r.provider, variant: r.variant, location: r.location });
      storage.set(r.media_id, list);
    }
  }
  const media: ArchiveMedia[] = [];
  let n = 0;
  for (const id of ids) {
    if (++n % 10 === 0) onProgress?.(`Файлы: ${n} из ${ids.length}…`);
    const meta = await getMediaMeta(id).catch(() => null);
    if (!meta) continue;
    const item: ArchiveMedia = { ...meta, storage: storage.get(id) };
    delete item.drive;
    if (withPreviews && meta.kind !== "audio") {
      const url = await getMediaUrl(id, "thumb").catch(() => null);
      if (url) item.thumb = await blobToDataUrl(await (await fetch(url)).blob()).catch(() => undefined);
    }
    media.push(item);
  }
  const archive: Archive = { app: "my-history", version: 1, exportedAt: new Date().toISOString(), trips, media };
  return new Blob([JSON.stringify(archive)], { type: "application/json" });
}

/** Добавляет из архива поездки и события, которых ещё нет (существующие не перезаписываются). */
export async function restoreArchive(file: File, onProgress?: (s: string) => void): Promise<{ added: number; skipped: number; previews: number }> {
  const data = JSON.parse(await file.text()) as Archive;
  if (data?.app !== "my-history" || !Array.isArray(data.trips)) throw new Error("Это не архив «Моей истории»");
  const repo = await getRepo();
  const have = new Set([...(await repo.list()), ...(await repo.listTrash())].map((t) => t.id));
  let previews = 0;
  for (const m of data.media ?? []) {
    const { thumb, storage: _s, ...meta } = m;
    void _s;
    const blob = thumb ? await (await fetch(thumb)).blob().catch(() => undefined) : undefined;
    if (await importMediaPreview(meta, blob).catch(() => false)) previews++;
  }
  let added = 0;
  let skipped = 0;
  for (const t of data.trips) {
    if (have.has(t.id)) {
      skipped++;
      continue;
    }
    onProgress?.(`Восстанавливаю «${t.title}»…`);
    await repo.save(t);
    added++;
  }
  return { added, skipped, previews };
}

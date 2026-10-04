/**
 * Хранилище поездок. Два режима с одинаковым интерфейсом:
 *  - local: IndexedDB на устройстве (пока пользователь не вошёл или Supabase не настроен);
 *  - cloud: Supabase (таблицы trips и checkpoints), с локальным кэшем для офлайна.
 */
import { addMediaFromDataUrl, queueUpload, listLocalMediaIds, syncPendingUploads } from "./media/store";
import { idb, STORES } from "./media/idb";
import { createCheckpoint, newId, normalizeOrder } from "./markerStyle";
import { getSupabase, getUserId } from "./supabase";
import type { Checkpoint, Trip } from "./types";

const LOCAL_KEY = "trips";
const CACHE_KEY = "trips-cloud-cache";
const LEGACY_KEY = "my-history-events";

export interface TripRepo {
  readonly mode: "local" | "cloud";
  list(): Promise<Trip[]>;
  get(id: string): Promise<Trip | null>;
  save(trip: Trip): Promise<void>;
  remove(id: string): Promise<void>;
}

function sortTrips(trips: Trip[]) {
  return [...trips].sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? "")));
}

/** Приводит запись к актуальной схеме (на случай старых данных). */
export function upgradeTrip(t: Partial<Trip> & { id: string }): Trip {
  const now = new Date().toISOString();
  return {
    title: "Без названия",
    date: now.slice(0, 10),
    mediaIds: [],
    createdAt: now,
    updatedAt: now,
    ...t,
    checkpoints: normalizeOrder((t.checkpoints ?? []).map((c) => ({ ...createCheckpoint(c.kind ?? "regular"), ...c }))),
  } as Trip;
}

/* ───────────── Локальный режим ───────────── */

async function readLocal(key = LOCAL_KEY): Promise<Trip[]> {
  const data = await idb.get<Trip[]>(STORES.kv, key).catch(() => undefined);
  return (data ?? []).map(upgradeTrip);
}

async function writeLocal(trips: Trip[], key = LOCAL_KEY) {
  await idb.set(STORES.kv, key, trips);
}

type LegacyMemory = { id: string; title: string; date: string; place?: string; text?: string; photos?: string[] };

/** Переносит события старого прототипа (localStorage + base64) в новую модель. */
async function migrateLegacy(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const items = JSON.parse(raw) as LegacyMemory[];
    const trips = await readLocal();
    for (const m of items) {
      if (m.id === "demo-zoo" || trips.some((t) => t.id === m.id)) continue;
      const mediaIds: string[] = [];
      for (const p of m.photos ?? []) {
        const meta = await addMediaFromDataUrl(p);
        if (meta) mediaIds.push(meta.id);
      }
      const now = new Date().toISOString();
      trips.push(
        upgradeTrip({
          id: m.id,
          title: m.title,
          date: m.date,
          place: m.place,
          description: m.text,
          coverMediaId: mediaIds[0],
          mediaIds,
          checkpoints: [],
          createdAt: now,
          updatedAt: now,
        })
      );
    }
    await writeLocal(trips);
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) {
    console.warn("Не удалось перенести старые события", e);
  }
}

const localRepo: TripRepo = {
  mode: "local",
  async list() {
    await migrateLegacy();
    return sortTrips(await readLocal());
  },
  async get(id) {
    return (await readLocal()).find((t) => t.id === id) ?? null;
  },
  async save(trip) {
    const trips = await readLocal();
    const i = trips.findIndex((t) => t.id === trip.id);
    if (i >= 0) trips[i] = trip;
    else trips.push(trip);
    await writeLocal(trips);
  },
  async remove(id) {
    await writeLocal((await readLocal()).filter((t) => t.id !== id));
  },
};

/* ───────────── Облачный режим (Supabase) ───────────── */

type TripRow = {
  id: string;
  owner_id: string;
  title: string;
  date: string;
  time: string | null;
  place: string | null;
  description: string | null;
  cover_media_id: string | null;
  media_ids: string[] | null;
  route: Trip["route"] | null;
  meta?: Trip["meta"] | null;
  created_at: string;
  updated_at: string;
};

type CheckpointRow = {
  id: string;
  trip_id: string;
  owner_id: string;
  position: number;
  kind: Checkpoint["kind"];
  title: string;
  description: string | null;
  time: string | null;
  lat: number | null;
  lon: number | null;
  location_label: string | null;
  style: Checkpoint["style"];
  importance: number;
  arrived_by: Checkpoint["arrivedBy"] | null;
  cover_media_id: string | null;
  media_ids: string[] | null;
  place: Checkpoint["place"] | null;
  meta?: Checkpoint["meta"] | null;
};

/**
 * Колонка meta появилась позже (supabase/migrations/001_meta.sql). Если её ещё нет в базе,
 * сохраняем без неё, а дату/погоду моментов держим в локальном кэше — старые данные не ломаются.
 */
let cloudHasMeta = true;
const isMissingMeta = (e: unknown) => /meta/i.test(String((e as { message?: string })?.message ?? "")) && /column|schema/i.test(String((e as { message?: string })?.message ?? ""));

function stripMeta<T extends { meta?: unknown }>(row: T): Omit<T, "meta"> {
  const { meta: _m, ...rest } = row;
  void _m;
  return rest;
}

/** Подставляет meta из локального кэша, если облако его не вернуло. */
function mergeMeta(cloud: Trip, cached?: Trip): Trip {
  if (!cached) return cloud;
  return {
    ...cloud,
    meta: cloud.meta ?? cached.meta,
    checkpoints: cloud.checkpoints.map((c) => ({ ...c, meta: c.meta ?? cached.checkpoints.find((x) => x.id === c.id)?.meta })),
  };
}

function toTripRow(t: Trip, ownerId: string): TripRow {
  return {
    id: t.id,
    owner_id: ownerId,
    title: t.title,
    date: t.date,
    time: t.time ?? null,
    place: t.place ?? null,
    description: t.description ?? null,
    cover_media_id: t.coverMediaId ?? null,
    media_ids: t.mediaIds,
    route: t.route ?? null,
    meta: t.meta ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

function toCheckpointRow(c: Checkpoint, tripId: string, ownerId: string, position: number): CheckpointRow {
  return {
    id: c.id,
    trip_id: tripId,
    owner_id: ownerId,
    position,
    kind: c.kind,
    title: c.title,
    description: c.description ?? null,
    time: c.time ?? null,
    lat: c.location?.lat ?? null,
    lon: c.location?.lon ?? null,
    location_label: c.location?.label ?? null,
    style: c.style,
    importance: c.importance,
    arrived_by: c.arrivedBy ?? null,
    cover_media_id: c.coverMediaId ?? null,
    media_ids: c.mediaIds,
    place: c.place ?? null,
    meta: c.meta ?? null,
  };
}

function fromRows(t: TripRow, cps: CheckpointRow[]): Trip {
  return upgradeTrip({
    id: t.id,
    title: t.title,
    date: t.date,
    time: t.time ?? undefined,
    place: t.place ?? undefined,
    description: t.description ?? undefined,
    coverMediaId: t.cover_media_id ?? undefined,
    mediaIds: t.media_ids ?? [],
    route: t.route ?? undefined,
    meta: t.meta ?? undefined,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    checkpoints: cps
      .filter((c) => c.trip_id === t.id)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        description: c.description ?? undefined,
        time: c.time ?? undefined,
        location:
          c.lat != null && c.lon != null
            ? { lat: c.lat, lon: c.lon, label: c.location_label ?? undefined }
            : undefined,
        style: c.style,
        importance: c.importance,
        arrivedBy: c.arrived_by ?? undefined,
        coverMediaId: c.cover_media_id ?? undefined,
        mediaIds: c.media_ids ?? [],
        place: c.place ?? undefined,
        meta: c.meta ?? undefined,
      })),
  });
}

function cloudRepo(ownerId: string): TripRepo {
  const sb = getSupabase()!;
  return {
    mode: "cloud",
    async list() {
      try {
        const [{ data: trips, error: e1 }, { data: cps, error: e2 }] = await Promise.all([
          sb.from("trips").select("*"),
          sb.from("checkpoints").select("*"),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        const cached = await readLocal(CACHE_KEY).catch(() => [] as Trip[]);
        const result = sortTrips(
          (trips as TripRow[]).map((t) => mergeMeta(fromRows(t, (cps ?? []) as CheckpointRow[]), cached.find((c) => c.id === t.id)))
        );
        await writeLocal(result, CACHE_KEY).catch(() => undefined);
        return result;
      } catch (e) {
        console.warn("Нет связи с облаком, показываю кэш", e);
        return sortTrips(await readLocal(CACHE_KEY));
      }
    },
    async get(id) {
      try {
        const [{ data: t, error: e1 }, { data: cps, error: e2 }] = await Promise.all([
          sb.from("trips").select("*").eq("id", id).maybeSingle(),
          sb.from("checkpoints").select("*").eq("trip_id", id),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (!t) return null;
        const cached = (await readLocal(CACHE_KEY).catch(() => [] as Trip[])).find((c) => c.id === id);
        return mergeMeta(fromRows(t as TripRow, (cps ?? []) as CheckpointRow[]), cached);
      } catch {
        return (await readLocal(CACHE_KEY)).find((t) => t.id === id) ?? null;
      }
    },
    async save(trip) {
      const cache = await readLocal(CACHE_KEY);
      const i = cache.findIndex((t) => t.id === trip.id);
      if (i >= 0) cache[i] = trip;
      else cache.push(trip);
      await writeLocal(cache, CACHE_KEY).catch(() => undefined);

      const tripRow = toTripRow(trip, ownerId);
      let { error } = await sb.from("trips").upsert(cloudHasMeta ? tripRow : stripMeta(tripRow));
      if (error && cloudHasMeta && isMissingMeta(error)) {
        cloudHasMeta = false;
        ({ error } = await sb.from("trips").upsert(stripMeta(tripRow)));
      }
      if (error) throw error;
      const rows = trip.checkpoints.map((c, idx) => toCheckpointRow(c, trip.id, ownerId, idx));
      if (rows.length) {
        let { error: e2 } = await sb.from("checkpoints").upsert(cloudHasMeta ? rows : rows.map(stripMeta));
        if (e2 && cloudHasMeta && isMissingMeta(e2)) {
          cloudHasMeta = false;
          ({ error: e2 } = await sb.from("checkpoints").upsert(rows.map(stripMeta)));
        }
        if (e2) throw e2;
      }
      const keep = rows.map((r) => r.id);
      let del = sb.from("checkpoints").delete().eq("trip_id", trip.id);
      if (keep.length) del = del.not("id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
      const { error: e3 } = await del;
      if (e3) throw e3;
    },
    async remove(id) {
      await writeLocal((await readLocal(CACHE_KEY)).filter((t) => t.id !== id), CACHE_KEY).catch(() => undefined);
      const { error } = await sb.from("trips").delete().eq("id", id);
      if (error) throw error;
    },
  };
}

export async function getRepo(): Promise<TripRepo> {
  const userId = await getUserId();
  if (userId) return cloudRepo(userId);
  return localRepo;
}

/** Сколько поездок хранится только на этом устройстве (ещё не в аккаунте). */
export async function localTripCount(): Promise<number> {
  await migrateLegacy();
  return (await readLocal()).length;
}

/** Переносит поездки и медиа с устройства в аккаунт. Копия поездок остаётся в резервной записи на устройстве. */
export async function migrateLocalToCloud(onProgress?: (msg: string) => void): Promise<number> {
  const userId = await getUserId();
  if (!userId) throw new Error("Сначала войдите в аккаунт");
  await migrateLegacy();
  const trips = await readLocal();
  const repo = cloudRepo(userId);
  let n = 0;
  for (const t of trips) {
    onProgress?.(`Поездка «${t.title}»…`);
    await repo.save(t);
    n++;
  }
  onProgress?.("Загружаю фотографии…");
  await queueUpload(await listLocalMediaIds());
  await syncPendingUploads();
  await writeLocal([], LOCAL_KEY);
  await writeLocal(trips, "trips-before-cloud-backup");
  return n;
}

export function newTrip(partial: Partial<Trip> = {}): Trip {
  const now = new Date().toISOString();
  return upgradeTrip({
    id: partial.id ?? newId(),
    title: "Новая поездка",
    date: now.slice(0, 10),
    mediaIds: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
}

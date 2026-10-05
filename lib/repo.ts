/**
 * Хранилище поездок. Два режима с одинаковым интерфейсом:
 *  - local: IndexedDB на устройстве (пока пользователь не вошёл или Supabase не настроен);
 *  - cloud: Supabase (таблицы trips и checkpoints), с локальным кэшем для офлайна.
 *
 * Надёжность:
 *  - каждое изменение сначала записывается на устройство (одной транзакцией IndexedDB), затем в облако;
 *  - отправка в облако идёт строго по очереди (одна блокировка на сохранения и догрузку),
 *    и запись снимается с очереди только если в облако ушла её последняя версия;
 *  - если облако отказало не из-за сети, запись попадает в «не отправлено» с текстом ошибки, а не крутится вечно.
 */
import { addMediaFromDataUrl, queueUpload, listLocalMediaIds, syncPendingUploads } from "./media/store";
import { idb, STORES } from "./media/idb";
import { createCheckpoint, newId, normalizeOrder } from "./markerStyle";
import { localToday } from "./format";
import { getSupabase, getUserId } from "./supabase";
import type { Checkpoint, Trip, UserData } from "./types";

const LOCAL_KEY = "trips";
const CACHE_KEY = "trips-cloud-cache";
const LEGACY_KEY = "my-history-events";

export interface TripRepo {
  readonly mode: "local" | "cloud";
  /** Все поездки и события, кроме лежащих в корзине. */
  list(): Promise<Trip[]>;
  get(id: string): Promise<Trip | null>;
  save(trip: Trip): Promise<void>;
  /** Переносит в корзину (можно восстановить 30 дней). */
  remove(id: string): Promise<void>;
  /** Корзина. Записи старше 30 дней при открытии удаляются окончательно. */
  listTrash(): Promise<Trip[]>;
  restore(id: string): Promise<void>;
  /** Удаляет навсегда (сами файлы фото/видео не трогаются). */
  purge(id: string): Promise<void>;
  /** Служебная запись с альбомами, «Хочу поехать» и шаблонами (синхронизируется как обычная поездка). */
  system(): Promise<Trip | null>;
  /** Id служебной записи этого пользователя (один и тот же на всех устройствах). */
  systemId(): string;
  /**
   * Всё, включая корзину и служебную запись, — строго из облака (без подстановки кэша).
   * Нужно там, где ошибка опасна: например, перед удалением «ненужных» файлов.
   */
  everythingStrict(): Promise<Trip[]>;
}

export const isSystem = (t: Trip) => t.meta?.kind === "system";

export const TRASH_DAYS = 30;
const isTrashed = (t: Trip) => Boolean(t.meta?.deletedAt) && t.meta?.kind !== "system";
/** Не показывается в списках: в корзине или служебная запись. */
const hidden = (t: Trip) => Boolean(t.meta?.deletedAt) || t.meta?.kind === "system";
const expired = (t: Trip) => Date.now() - new Date(t.meta!.deletedAt!).getTime() > TRASH_DAYS * 86_400_000;
const trashed = (t: Trip): Trip => ({ ...t, meta: { ...t.meta, deletedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() });
const restored = (t: Trip): Trip => {
  const meta = { ...t.meta };
  delete meta.deletedAt;
  return { ...t, meta, updatedAt: new Date().toISOString() };
};

/** Служебная запись: локально — постоянный id, в облаке — производный от id пользователя. */
const LOCAL_SYSTEM_ID = "00000000-0000-4000-8000-000000005157";
const cloudSystemId = (uid: string) => `${uid.slice(0, 24)}5157e3a0c0de`;

/** Объединяет данные нескольких служебных записей (например, после переноса с другого устройства). */
export function mergeUserData(a: UserData = {}, b: UserData = {}): UserData {
  const merge = <T extends { id: string }>(x: T[] = [], y: T[] = []) => [...x, ...y.filter((i) => !x.some((j) => j.id === i.id))];
  return { albums: merge(a.albums, b.albums), wishes: merge(a.wishes, b.wishes), packTemplates: merge(a.packTemplates, b.packTemplates) };
}

function pickSystem(all: Trip[], id: string): Trip | null {
  const list = all.filter(isSystem);
  if (!list.length) return null;
  const main = list.find((t) => t.id === id) ?? list[0];
  if (list.length === 1) return main;
  const userData = list.reduce<UserData>((acc, t) => mergeUserData(acc, t.meta?.userData), main.meta?.userData ?? {});
  return { ...main, meta: { ...main.meta, userData } };
}

/* ───────────── Очередь изменений без сети ───────────── */

const PENDING_SAVES = "pending-trip-saves";
const PENDING_DELETES = "pending-trip-deletes";
const FAILED = "failed-trip-saves";
const tripSyncListeners = new Set<() => void>();
export function onTripSyncChange(fn: () => void): () => void {
  tripSyncListeners.add(fn);
  return () => tripSyncListeners.delete(fn);
}
const emitTripSync = () => tripSyncListeners.forEach((fn) => fn());

async function getIds(key: string): Promise<string[]> {
  return (await idb.get<string[]>(STORES.kv, key).catch(() => undefined)) ?? [];
}
/** Атомарно меняет список id (одна транзакция — без гонок с параллельными изменениями). */
async function changeIds(key: string, fn: (ids: string[]) => string[]) {
  await idb.update<string[]>(STORES.kv, key, (cur) => Array.from(new Set(fn(cur ?? []))));
  emitTripSync();
}

type FailedMap = Record<string, string>;
async function getFailed(): Promise<FailedMap> {
  return (await idb.get<FailedMap>(STORES.kv, FAILED).catch(() => undefined)) ?? {};
}
async function changeFailed(fn: (m: FailedMap) => FailedMap) {
  await idb.update<FailedMap>(STORES.kv, FAILED, (cur) => fn({ ...(cur ?? {}) }));
  emitTripSync();
}

/** Сколько изменений поездок ждут отправки в облако. */
export async function pendingTripCount(): Promise<number> {
  return (await getIds(PENDING_SAVES)).length + (await getIds(PENDING_DELETES)).length;
}

/** Изменения, которые облако не приняло (не из-за сети): id → текст ошибки. */
export async function failedTrips(): Promise<{ id: string; title: string; error: string }[]> {
  const m = await getFailed();
  const cache = await readLocal(CACHE_KEY).catch(() => [] as Trip[]);
  return Object.entries(m).map(([id, error]) => ({ id, error, title: cache.find((t) => t.id === id)?.title ?? "Запись" }));
}

/** Повторить отправку не принятых облаком изменений. */
export async function retryFailed() {
  const ids = Object.keys(await getFailed());
  await changeFailed(() => ({}));
  await changeIds(PENDING_SAVES, (cur) => [...cur, ...ids]);
  await flushPendingTrips();
}

/** Ошибка связи (а не отказ сервера): такое изменение просто ждёт сети. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String((e as { message?: string })?.message ?? e);
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|timeout|offline|aborted/i.test(msg);
}

const errText = (e: unknown) => String((e as { message?: string })?.message ?? e).slice(0, 200);

function sortTrips(trips: Trip[]) {
  return [...trips].sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? "")));
}

/** Приводит запись к актуальной схеме (на случай старых данных). */
export function upgradeTrip(t: Partial<Trip> & { id: string }): Trip {
  const now = new Date().toISOString();
  return {
    title: "Без названия",
    date: localToday(),
    mediaIds: [],
    createdAt: now,
    updatedAt: now,
    ...t,
    checkpoints: normalizeOrder((t.checkpoints ?? []).map((c) => ({ ...createCheckpoint(c.kind ?? "regular"), ...c }))),
  } as Trip;
}

/* ───────────── Локальное хранение ───────────── */

/** Чтение списка. Ошибка чтения НЕ превращается в пустой список — иначе следующая запись стёрла бы всё. */
async function readLocal(key = LOCAL_KEY): Promise<Trip[]> {
  const data = await idb.get<Trip[]>(STORES.kv, key);
  return (data ?? []).map(upgradeTrip);
}

async function writeLocal(trips: Trip[], key = LOCAL_KEY) {
  await idb.set(STORES.kv, key, trips);
}

/** Изменение списка поездок одной транзакцией (без потери параллельных изменений). */
async function mutateLocal(key: string, fn: (list: Trip[]) => Trip[]) {
  await idb.update<Trip[]>(STORES.kv, key, (cur) => fn(cur ?? []));
}
const upsertIn = (trip: Trip) => (list: Trip[]) => {
  const i = list.findIndex((t) => t.id === trip.id);
  const next = [...list];
  if (i >= 0) next[i] = trip;
  else next.push(trip);
  return next;
};

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
    return sortTrips((await readLocal()).filter((t) => !hidden(t)));
  },
  async get(id) {
    return (await readLocal()).find((t) => t.id === id) ?? null;
  },
  async save(trip) {
    await mutateLocal(LOCAL_KEY, upsertIn(trip));
  },
  async remove(id) {
    const t = await localRepo.get(id);
    if (t) await localRepo.save(trashed(t));
  },
  async listTrash() {
    const all = await readLocal();
    const old = all.filter((t) => isTrashed(t) && expired(t)).map((t) => t.id);
    if (old.length) await mutateLocal(LOCAL_KEY, (list) => list.filter((t) => !old.includes(t.id)));
    return sortTrips(all.filter((t) => isTrashed(t) && !expired(t)));
  },
  async restore(id) {
    const t = await localRepo.get(id);
    if (t) await localRepo.save(restored(t));
  },
  async purge(id) {
    await mutateLocal(LOCAL_KEY, (list) => list.filter((t) => t.id !== id));
  },
  async system() {
    return pickSystem(await readLocal(), LOCAL_SYSTEM_ID);
  },
  systemId: () => LOCAL_SYSTEM_ID,
  async everythingStrict() {
    return readLocal();
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

/** Supabase отдаёт не больше 1000 строк за запрос — читаем постранично, иначе часть данных молча пропадёт. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selectAll<T>(table: string, build?: (q: any) => any): Promise<T[]> {
  const sb = getSupabase()!;
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb.from(table).select("*").order("id");
    if (build) q = build(q);
    const { data, error } = (await q.range(from, from + page - 1)) as { data: T[] | null; error: unknown };
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}

async function cloudWrite(ownerId: string, trip: Trip) {
  const sb = getSupabase()!;
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
}

async function cloudDelete(id: string) {
  const { error } = await getSupabase()!.from("trips").delete().eq("id", id);
  if (error) throw error;
}

/** Одна очередь на все отправки в облако: сохранение и догрузка не перетирают друг друга. */
let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

/**
 * Отправляет в облако текущую (последнюю на устройстве) версию поездки.
 * Снимает её с очереди, только если пока шла отправка она не изменилась.
 */
async function pushOne(ownerId: string, id: string): Promise<"ok" | "offline" | "failed"> {
  const t = (await readLocal(CACHE_KEY)).find((x) => x.id === id);
  if (!t) {
    await changeIds(PENDING_SAVES, (cur) => cur.filter((x) => x !== id));
    return "ok";
  }
  try {
    await cloudWrite(ownerId, t);
  } catch (e) {
    if (isNetworkError(e)) return "offline";
    console.warn("Облако не приняло запись", id, e);
    await changeIds(PENDING_SAVES, (cur) => cur.filter((x) => x !== id));
    await changeFailed((m) => ({ ...m, [id]: errText(e) }));
    return "failed";
  }
  const now = (await readLocal(CACHE_KEY).catch(() => [] as Trip[])).find((x) => x.id === id);
  if (!now || now.updatedAt === t.updatedAt) {
    await changeIds(PENDING_SAVES, (cur) => cur.filter((x) => x !== id));
    await changeFailed((m) => {
      delete m[id];
      return m;
    });
  }
  return "ok";
}

let flushing: Promise<number> | null = null;

/** Отправляет в облако всё, что было изменено без сети. Возвращает, сколько осталось. */
export function flushPendingTrips(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    const ownerId = await getUserId();
    if (!ownerId || !getSupabase()) return 0;
    for (let round = 0; round < 3; round++) {
      const saves = await getIds(PENDING_SAVES);
      if (!saves.length) break;
      let offline = false;
      for (const id of saves) {
        const r = await exclusive(() => pushOne(ownerId, id));
        if (r === "offline") {
          offline = true;
          break;
        }
      }
      if (offline) break;
    }
    for (const id of await getIds(PENDING_DELETES)) {
      try {
        await exclusive(() => cloudDelete(id));
        await changeIds(PENDING_DELETES, (cur) => cur.filter((x) => x !== id));
      } catch (e) {
        if (isNetworkError(e)) break;
      }
    }
    return pendingTripCount();
  })()
    .catch(() => pendingTripCount())
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushPendingTrips());
}

function cloudRepo(ownerId: string): TripRepo {
  const sb = getSupabase()!;
  const sysId = cloudSystemId(ownerId);

  const putCache = (trip: Trip) => mutateLocal(CACHE_KEY, upsertIn(trip));

  /** Всё из облака, без подстановки кэша (ошибка — исключение). */
  async function fromCloud(): Promise<Trip[]> {
    const [trips, cps] = await Promise.all([selectAll<TripRow>("trips"), selectAll<CheckpointRow>("checkpoints")]);
    const cached = await readLocal(CACHE_KEY).catch(() => [] as Trip[]);
    const byTrip = new Map<string, CheckpointRow[]>();
    for (const c of cps) {
      if (!byTrip.has(c.trip_id)) byTrip.set(c.trip_id, []);
      byTrip.get(c.trip_id)!.push(c);
    }
    return trips.map((t) => mergeMeta(fromRows(t, byTrip.get(t.id) ?? []), cached.find((c) => c.id === t.id)));
  }

  async function all(): Promise<Trip[]> {
    await flushPendingTrips().catch(() => undefined);
    try {
      const cloud = await fromCloud();
      // Не отправленные (или не принятые облаком) изменения важнее того, что пока лежит в облаке.
      const local = new Set([...(await getIds(PENDING_SAVES)), ...Object.keys(await getFailed())]);
      const dels = new Set(await getIds(PENDING_DELETES));
      let result: Trip[] = [];
      await mutateLocal(CACHE_KEY, (cached) => {
        const merged = cloud.filter((t) => !dels.has(t.id)).map((t) => (local.has(t.id) ? cached.find((c) => c.id === t.id) ?? t : t));
        const onlyLocal = cached.filter((c) => local.has(c.id) && !merged.some((t) => t.id === c.id));
        result = sortTrips([...merged, ...onlyLocal].map(upgradeTrip));
        return result;
      });
      return result;
    } catch (e) {
      console.warn("Нет связи с облаком, показываю кэш", e);
      return sortTrips(await readLocal(CACHE_KEY).catch(() => [] as Trip[]));
    }
  }

  const repo: TripRepo = {
    mode: "cloud",
    async list() {
      return (await all()).filter((t) => !hidden(t));
    },
    async get(id) {
      const local = new Set([...(await getIds(PENDING_SAVES)), ...Object.keys(await getFailed())]);
      if (local.has(id)) {
        const t = (await readLocal(CACHE_KEY).catch(() => [] as Trip[])).find((x) => x.id === id);
        if (t) return t;
      }
      try {
        const [{ data: t, error: e1 }, cps] = await Promise.all([
          sb.from("trips").select("*").eq("id", id).maybeSingle(),
          selectAll<CheckpointRow>("checkpoints", (q) => q.eq("trip_id", id)),
        ]);
        if (e1) throw e1;
        if (!t) return null;
        const cached = (await readLocal(CACHE_KEY).catch(() => [] as Trip[])).find((c) => c.id === id);
        return mergeMeta(fromRows(t as TripRow, cps), cached);
      } catch {
        return (await readLocal(CACHE_KEY).catch(() => [] as Trip[])).find((t) => t.id === id) ?? null;
      }
    },
    async save(trip) {
      // Сначала на устройство — изменение не потеряется, даже если сети нет.
      await putCache(trip);
      await changeIds(PENDING_SAVES, (cur) => [...cur, trip.id]);
      const r = await exclusive(() => pushOne(ownerId, trip.id));
      if (r === "failed") {
        const why = (await getFailed())[trip.id];
        throw new Error(`Сохранено на устройстве, но облако не приняло изменение: ${why}`);
      }
    },
    async remove(id) {
      const t = await repo.get(id);
      if (t) await repo.save(trashed(t));
    },
    async listTrash() {
      const list = (await all()).filter(isTrashed);
      for (const t of list.filter(expired)) await repo.purge(t.id).catch(() => undefined);
      return list.filter((t) => !expired(t));
    },
    async restore(id) {
      // Берём поездку целиком именно по id (а не из общего списка) — чтобы не потерять ни одной точки.
      const t = await repo.get(id);
      if (t) await repo.save(restored(t));
    },
    async system() {
      return pickSystem(await all(), sysId);
    },
    systemId: () => sysId,
    async everythingStrict() {
      await flushPendingTrips().catch(() => undefined);
      const cloud = await fromCloud();
      const local = new Set([...(await getIds(PENDING_SAVES)), ...Object.keys(await getFailed())]);
      const cached = await readLocal(CACHE_KEY).catch(() => [] as Trip[]);
      return [...cloud, ...cached.filter((c) => local.has(c.id) && !cloud.some((t) => t.id === c.id))];
    },
    async purge(id) {
      await mutateLocal(CACHE_KEY, (list) => list.filter((t) => t.id !== id)).catch(() => undefined);
      await changeIds(PENDING_SAVES, (cur) => cur.filter((x) => x !== id));
      await changeFailed((m) => {
        delete m[id];
        return m;
      });
      try {
        await exclusive(() => cloudDelete(id));
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        await changeIds(PENDING_DELETES, (cur) => [...cur, id]);
      }
    },
  };
  return repo;
}

export async function getRepo(): Promise<TripRepo> {
  const userId = await getUserId();
  if (userId) return cloudRepo(userId);
  return localRepo;
}

/** Сколько поездок хранится только на этом устройстве (ещё не в аккаунте). */
export async function localTripCount(): Promise<number> {
  await migrateLegacy();
  return (await readLocal()).filter((t) => !isSystem(t)).length;
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
    if (isSystem(t)) {
      // Альбомы и «Хочу поехать» с устройства добавляем к уже существующим в аккаунте, а не заводим вторую запись.
      const cur = await repo.system();
      const base = cur ?? newTrip({ id: repo.systemId(), title: "Служебная запись «Моей истории»", date: "2000-01-01", meta: { kind: "system", userData: {} } });
      await repo.save({ ...base, meta: { ...base.meta, kind: "system", userData: mergeUserData(base.meta?.userData, t.meta?.userData) }, updatedAt: new Date().toISOString() });
      continue;
    }
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
    date: localToday(),
    mediaIds: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
}

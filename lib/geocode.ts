/**
 * Поиск мест (в первую очередь по России) через OpenStreetMap Nominatim.
 * Бесплатно и без ключа; запросы редкие (поиск с задержкой ввода).
 */
export type PlaceHit = { label: string; short: string; lat: number; lon: number };

const BASE = "https://nominatim.openstreetmap.org";

function shortName(a: Record<string, string> | undefined, fallback: string): string {
  if (!a) return fallback.split(",")[0];
  return a.attraction || a.park || a.station || a.tourism || a.amenity || a.leisure || a.railway || a.station || a.road || a.village || a.town || a.city || fallback.split(",")[0];
}

function region(a: Record<string, string> | undefined, short: string): string {
  if (!a) return "";
  const parts = [a.city || a.town || a.village || a.municipality, a.state || a.region].filter(Boolean) as string[];
  // Без повторов: «Москва, Москва» → «Москва»; само название места в регион не попадает.
  return Array.from(new Set(parts)).filter((p) => p !== short).join(", ");
}

function build(name: string | undefined, a: Record<string, string> | undefined, display: string) {
  const short = (name && name.trim()) || shortName(a, display);
  const r = region(a, short);
  return { short, label: r ? `${short}, ${r}` : short };
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const params = new URLSearchParams({ q, format: "jsonv2", addressdetails: "1", limit: "7", "accept-language": "ru", countrycodes: "ru" });
  const res = await fetch(`${BASE}/search?${params}`, { signal });
  if (!res.ok) throw new Error("Поиск мест недоступен");
  const list = (await res.json()) as { name?: string; display_name: string; lat: string; lon: string; address?: Record<string, string> }[];
  const seen = new Set<string>();
  return list
    .map((p) => ({ ...build(p.name, p.address, p.display_name), lat: Number(p.lat), lon: Number(p.lon) }))
    .filter((h) => (seen.has(h.label) ? false : (seen.add(h.label), true)));
}

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", addressdetails: "1", "accept-language": "ru", zoom: "16" });
    const res = await fetch(`${BASE}/reverse?${params}`);
    if (!res.ok) return null;
    const p = (await res.json()) as { name?: string; display_name?: string; address?: Record<string, string> };
    if (!p.display_name) return null;
    return build(p.name, p.address, p.display_name).label;
  } catch {
    return null;
  }
}

export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Геолокация недоступна"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error("Не удалось определить местоположение")),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

/* ───────────── Обратное геокодирование с кэшем и очередью (не чаще 1 запроса в секунду) ───────────── */

export type ReverseInfo = {
  /** Улица/объект с городом и регионом — подходит как адрес. */
  label: string;
  short: string;
  /** Название для момента: достопримечательность, а если её нет — город или посёлок. */
  place?: string;
  city?: string;
  state?: string;
  country?: string;
};

let chain: Promise<unknown> = Promise.resolve();
let last = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

const memo = new Map<string, Promise<ReverseInfo | null>>();

/**
 * Место по координатам: название, регион (субъект РФ) и страна. Результат кэшируется на устройстве,
 * поэтому повторные открытия не обращаются к серверу. zoom 5 — только регион, 16 — точное место.
 */
export function reverseInfo(lat: number, lon: number, zoom: 5 | 16 = 16): Promise<ReverseInfo | null> {
  const digits = zoom === 5 ? 1 : 4;
  const key = `geo2:${zoom}:${lat.toFixed(digits)},${lon.toFixed(digits)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const p = (async () => {
    const { idb, STORES } = await import("./media/idb");
    const cached = await idb.get<ReverseInfo>(STORES.kv, key).catch(() => undefined);
    if (cached) return cached;
    const res = await throttled(() =>
      fetch(`${BASE}/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", addressdetails: "1", "accept-language": "ru", zoom: String(zoom) })}`)
    ).catch(() => null);
    if (!res || !res.ok) return null;
    const j = (await res.json().catch(() => null)) as { name?: string; category?: string; display_name?: string; address?: Record<string, string> } | null;
    if (!j?.display_name) return null;
    const b = build(zoom === 5 ? undefined : j.name, j.address, j.display_name);
    const a = j.address ?? {};
    const poi = j.name && /tourism|historic|amenity|leisure|railway|natural|aeroway|shop/.test(j.category ?? "") ? j.name : undefined;
    const city = a.city || a.town || a.village || a.hamlet || a.municipality;
    const info: ReverseInfo = { label: b.label, short: b.short, place: poi || city || b.short, city, state: a.state || a.region || a.city, country: a.country_code };
    await idb.set(STORES.kv, key, info).catch(() => undefined);
    return info;
  })();
  memo.set(key, p);
  p.then((v) => {
    if (!v) memo.delete(key);
  });
  return p;
}

/** Граница региона (упрощённая) для закраски на карте. Кэшируется на устройстве. */
export async function regionShape(name: string): Promise<object | null> {
  const key = `geo:shape:${name}`;
  const { idb, STORES } = await import("./media/idb");
  const cached = await idb.get<object | "none">(STORES.kv, key).catch(() => undefined);
  if (cached) return cached === "none" ? null : cached;
  const res = await throttled(() =>
    fetch(`${BASE}/search?${new URLSearchParams({ q: name, countrycodes: "ru", format: "jsonv2", polygon_geojson: "1", polygon_threshold: "0.02", limit: "5", "accept-language": "ru" })}`)
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const list = (await res.json().catch(() => [])) as { addresstype?: string; type?: string; geojson?: { type: string } }[];
  const hit =
    list.find((r) => (r.addresstype === "state" || r.addresstype === "region") && /Polygon/.test(r.geojson?.type ?? "")) ??
    list.find((r) => (r.addresstype === "city" || r.type === "administrative") && /Polygon/.test(r.geojson?.type ?? ""));
  const shape = hit?.geojson ?? null;
  await idb.set(STORES.kv, key, shape ?? "none").catch(() => undefined);
  return shape;
}

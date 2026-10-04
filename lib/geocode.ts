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

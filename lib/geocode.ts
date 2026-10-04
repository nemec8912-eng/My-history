/**
 * Поиск мест (в первую очередь по России) через OpenStreetMap Nominatim.
 * Бесплатно и без ключа; запросы редкие (поиск с задержкой ввода).
 */
export type PlaceHit = { label: string; short: string; lat: number; lon: number };

const BASE = "https://nominatim.openstreetmap.org";

function shortName(a: Record<string, string> | undefined, fallback: string): string {
  if (!a) return fallback.split(",")[0];
  return a.attraction || a.tourism || a.amenity || a.leisure || a.railway || a.station || a.road || a.village || a.town || a.city || fallback.split(",")[0];
}

function region(a: Record<string, string> | undefined): string {
  if (!a) return "";
  return [a.city || a.town || a.village, a.state || a.region].filter(Boolean).join(", ");
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const params = new URLSearchParams({ q, format: "jsonv2", addressdetails: "1", limit: "7", "accept-language": "ru", countrycodes: "ru" });
  const res = await fetch(`${BASE}/search?${params}`, { signal });
  if (!res.ok) throw new Error("Поиск мест недоступен");
  const list = (await res.json()) as { display_name: string; lat: string; lon: string; address?: Record<string, string> }[];
  return list.map((p) => {
    const short = shortName(p.address, p.display_name);
    const r = region(p.address);
    return { short, label: r && !short.includes(r) ? `${short}, ${r}` : short, lat: Number(p.lat), lon: Number(p.lon) };
  });
}

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", addressdetails: "1", "accept-language": "ru", zoom: "16" });
    const res = await fetch(`${BASE}/reverse?${params}`);
    if (!res.ok) return null;
    const p = (await res.json()) as { display_name?: string; address?: Record<string, string> };
    if (!p.display_name) return null;
    const short = shortName(p.address, p.display_name);
    const r = region(p.address);
    return r && !short.includes(r) ? `${short}, ${r}` : short;
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

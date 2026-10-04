/** «Интересное рядом»: статьи Википедии с координатами вокруг точки (бесплатно, без ключа). */
import { haversineKm } from "./format";
import type { GeoPoint } from "./types";

export type NearbyPlace = { id: number; title: string; description?: string; lat: number; lon: number; km: number; thumb?: string; url: string };

export async function wikiNearby(p: GeoPoint, radiusM = 10000, signal?: AbortSignal): Promise<NearbyPlace[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${p.lat}|${p.lon}`,
    ggsradius: String(Math.min(10000, radiusM)),
    ggslimit: "40",
    prop: "coordinates|pageimages|description",
    piprop: "thumbnail",
    pithumbsize: "240",
  });
  const res = await fetch(`https://ru.wikipedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) throw new Error("Википедия сейчас недоступна");
  const j = (await res.json()) as { query?: { pages?: Record<string, { pageid: number; title: string; description?: string; coordinates?: { lat: number; lon: number }[]; thumbnail?: { source: string } }> } };
  return Object.values(j.query?.pages ?? {})
    .filter((x) => x.coordinates?.[0])
    .map((x) => {
      const c = x.coordinates![0];
      return {
        id: x.pageid,
        title: x.title,
        description: x.description,
        lat: c.lat,
        lon: c.lon,
        km: haversineKm(p, c),
        thumb: x.thumbnail?.source,
        url: `https://ru.wikipedia.org/?curid=${x.pageid}`,
      };
    })
    .sort((a, b) => a.km - b.km);
}

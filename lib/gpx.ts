/** Импорт трека GPX (из Strava, Яндекс Карт, Organic Maps, часов и т. п.) как точного маршрута поездки. */
import { haversineKm } from "./format";
import type { RouteData } from "./types";

export function parseGpx(xml: string): RouteData {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Файл не похож на GPX");
  const nodes = Array.from(doc.getElementsByTagName("trkpt")).concat(Array.from(doc.getElementsByTagName("rtept")));
  const pts = nodes
    .map((n) => ({ lat: Number(n.getAttribute("lat")), lon: Number(n.getAttribute("lon")), time: n.getElementsByTagName("time")[0]?.textContent ?? undefined }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.lat || p.lon));
  if (pts.length < 2) throw new Error("В файле нет точек трека");
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
  // Для отображения хватает ~2000 точек: прореживаем длинные треки.
  const step = Math.max(1, Math.ceil(pts.length / 2000));
  const path = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [p.lon, p.lat] as [number, number]);
  const t0 = pts.find((p) => p.time)?.time;
  const t1 = [...pts].reverse().find((p) => p.time)?.time;
  const duration = t0 && t1 ? Math.max(0, (new Date(t1).getTime() - new Date(t0).getTime()) / 1000) : 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  return {
    mode: "pedestrian",
    from: { lat: first.lat, lon: first.lon },
    to: { lat: last.lat, lon: last.lon },
    distance: Math.round(km * 1000),
    duration: Math.round(duration),
    segments: [{ kind: "walk", path: [path] }],
    provider: "gpx",
    builtAt: new Date().toISOString(),
  };
}

/** Линия трека для карты в формате [lat, lon]. */
export const routeCoords = (r?: RouteData): [number, number][] =>
  r ? r.segments.flatMap((s) => s.path.flatMap((line) => line.map(([lon, lat]) => [lat, lon] as [number, number]))) : [];

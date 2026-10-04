/**
 * Раскладка пачки фото из галереи по дням и местам — по дате и GPS из EXIF.
 * Новая точка начинается, если между снимками больше 2 часов или больше 1,5 км.
 */
import { haversineKm } from "./format";
import type { GeoPoint } from "./types";

export type ImportFile = {
  key: string;
  file: File;
  takenAt: string; // YYYY-MM-DDTHH:MM:SS
  fromExif: boolean;
  gps?: GeoPoint;
  kind: "image" | "video";
};

export type ImportCluster = {
  key: string;
  date: string;
  from: string; // HH:MM
  to: string;
  files: ImportFile[];
  center?: GeoPoint;
};

export type ImportDay = { date: string; clusters: ImportCluster[]; count: number };

const GAP_MS = 2 * 3600_000;
const GAP_KM = 1.5;

const ms = (iso: string) => new Date(iso).getTime();

function centerOf(files: ImportFile[]): GeoPoint | undefined {
  const g = files.filter((f) => f.gps).map((f) => f.gps!);
  if (!g.length) return undefined;
  return { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length };
}

export function planImport(files: ImportFile[]): ImportDay[] {
  const sorted = [...files].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const days = new Map<string, ImportCluster[]>();
  let cur: ImportCluster | null = null;
  let lastGps: GeoPoint | undefined;
  for (const f of sorted) {
    const date = f.takenAt.slice(0, 10);
    const prev = cur?.files[cur.files.length - 1];
    const far = Boolean(f.gps && lastGps && haversineKm(f.gps, lastGps) > GAP_KM);
    if (!cur || cur.date !== date || (prev && ms(f.takenAt) - ms(prev.takenAt) > GAP_MS) || far) {
      cur = { key: `${date}-${f.key}`, date, from: f.takenAt.slice(11, 16), to: f.takenAt.slice(11, 16), files: [] };
      if (!days.has(date)) days.set(date, []);
      days.get(date)!.push(cur);
      lastGps = undefined;
    }
    cur.files.push(f);
    cur.to = f.takenAt.slice(11, 16);
    if (f.gps) lastGps = f.gps;
  }
  return Array.from(days.entries()).map(([date, clusters]) => {
    clusters.forEach((c) => (c.center = centerOf(c.files)));
    return { date, clusters, count: clusters.reduce((s, c) => s + c.files.length, 0) };
  });
}

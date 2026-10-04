/** Сводные цифры по реальным данным поездок. Ничего не выдумывается: нет данных — нет цифры. */
import { haversineKm } from "./format";
import type { Checkpoint, Trip } from "./types";

export const hasCoords = (c: Checkpoint) => Boolean(c.location && (c.location.lat || c.location.lon));

export function tripKm(t: Trip): number | null {
  const pts = t.checkpoints.filter(hasCoords).map((c) => c.location!);
  if (pts.length < 2) return null;
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
  return km;
}

export function tripEnd(t: Trip): string {
  const dates = [t.date, t.meta?.endDate, ...t.checkpoints.map((c) => c.meta?.date)].filter(Boolean) as string[];
  return dates.sort().pop() ?? t.date;
}

export function tripDays(t: Trip): number {
  const a = new Date(t.date + "T12:00:00").getTime();
  const b = new Date(tripEnd(t) + "T12:00:00").getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function tripPlaces(t: Trip): number {
  return t.checkpoints.filter((c) => hasCoords(c) || c.location?.label).length;
}

/** Все id медиа поездки (обложка, точки, мини-события). */
export function tripMediaIds(t: Trip): string[] {
  const ids = [...t.mediaIds, ...t.checkpoints.flatMap((c) => [...c.mediaIds, ...(c.place?.moments.flatMap((m) => m.mediaIds) ?? [])])];
  return Array.from(new Set(ids));
}

export function tripCover(t: Trip): string | undefined {
  return t.coverMediaId ?? t.checkpoints.find((c) => c.kind === "end" && c.coverMediaId)?.coverMediaId ?? t.checkpoints.find((c) => c.coverMediaId)?.coverMediaId;
}

const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «12 – 18 июля 2026» или «4 октября 2026». */
export function tripDateRange(t: Trip): string {
  const end = tripEnd(t);
  const [y1, m1, d1] = t.date.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  if (!y1) return t.date;
  if (end === t.date || !y2) return `${d1} ${RU_MONTHS_GEN[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${RU_MONTHS_GEN[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${RU_MONTHS_GEN[m1 - 1]} – ${d2} ${RU_MONTHS_GEN[m2 - 1]} ${y1}`;
  return `${d1} ${RU_MONTHS_GEN[m1 - 1]} ${y1} – ${d2} ${RU_MONTHS_GEN[m2 - 1]} ${y2}`;
}

/** Дата момента: своя или дата поездки. */
export const momentDate = (t: Trip, c: Checkpoint) => c.meta?.date ?? t.date;

/** Событие: явно помечено или не имеет точек «откуда/куда» (так тип сохраняется даже без колонки meta в базе). */
export const isEvent = (t: Trip) =>
  t.meta?.kind === "event" || (t.meta?.kind !== "trip" && !t.checkpoints.some((c) => c.kind === "start" || c.kind === "end"));
export const kindLabel = (t: Trip) => (isEvent(t) ? "Событие" : "Поездка");

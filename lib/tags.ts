/** Метки моментов: нормализация, список всех меток и фильтр поездок по метке. */
import type { Checkpoint, Trip } from "./types";

export const normTag = (s: string) => s.trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase().slice(0, 40);

export const cpTags = (c: Checkpoint) => c.meta?.tags ?? [];
export const tripTags = (t: Trip) => Array.from(new Set(t.checkpoints.flatMap(cpTags)));

/** Все метки пользователя, самые частые первыми. */
export function allTags(trips: Trip[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of trips) for (const c of t.checkpoints) for (const tag of cpTags(c)) m.set(tag, (m.get(tag) ?? 0) + 1);
  return Array.from(m.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export const tripHasTag = (t: Trip, tag: string | null) => !tag || t.checkpoints.some((c) => cpTags(c).includes(tag));
export const cpHasTag = (c: Checkpoint, tag: string | null) => !tag || cpTags(c).includes(tag);

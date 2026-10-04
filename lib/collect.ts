/** Сбор всех медиа пользователя с привязкой к поездке, моменту и дате. */
import { momentDate } from "./stats";
import type { Checkpoint, Trip } from "./types";

export type MediaRef = { id: string; trip: Trip; cp?: Checkpoint; date: string };

export function collectMedia(trips: Trip[]): MediaRef[] {
  const seen = new Set<string>();
  const out: MediaRef[] = [];
  const add = (id: string, trip: Trip, cp: Checkpoint | undefined, date: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, trip, cp, date });
  };
  for (const t of trips) {
    for (const c of t.checkpoints) {
      const d = momentDate(t, c);
      c.mediaIds.forEach((id) => add(id, t, c, d));
      c.place?.moments.forEach((m) => m.mediaIds.forEach((id) => add(id, t, c, d)));
    }
    t.mediaIds.forEach((id) => add(id, t, undefined, t.date));
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const monthLabel = (date: string) => `${MONTHS_NOM[Number(date.slice(5, 7)) - 1] ?? ""} ${date.slice(0, 4)}`;

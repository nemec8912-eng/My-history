/** Поиск по поездкам, событиям, моментам, местам, датам и описаниям — с первых букв. */
import { kindLabel, momentDate, tripDateRange } from "./stats";
import type { Checkpoint, Trip } from "./types";

const MONTHS = ["январь января", "февраль февраля", "март марта", "апрель апреля", "май мая", "июнь июня", "июль июля", "август августа", "сентябрь сентября", "октябрь октября", "ноябрь ноября", "декабрь декабря"];
const split = (s: string) => s.toLowerCase().split(/[\s,.()«»"–—-]+/).filter(Boolean);

function score(text: string, title: string, q: string): number {
  const t = title.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (split(t).some((w) => w.startsWith(q))) return 1;
  const words = split(text);
  if (words.some((w) => w.startsWith(q))) return 2;
  if (text.toLowerCase().includes(q)) return 3;
  return -1;
}

const dateWords = (d: string) => {
  const [y, m] = d.split("-");
  return `${y} ${MONTHS[Number(m) - 1] ?? ""}`;
};

export type MomentHit = { trip: Trip; cp: Checkpoint; score: number };

export function searchAll(trips: Trip[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return { trips: [] as Trip[], moments: [] as MomentHit[] };
  const tripHits = trips
    .map((t) => {
      const text = [t.title, t.place, t.description, kindLabel(t), tripDateRange(t), dateWords(t.date)].filter(Boolean).join(" ");
      return { t, s: score(text, t.title, q) };
    })
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || b.t.date.localeCompare(a.t.date))
    .map((x) => x.t);
  const moments: MomentHit[] = [];
  for (const t of trips) {
    for (const c of t.checkpoints) {
      const text = [c.title, c.description, c.location?.label, dateWords(momentDate(t, c)), ...(c.place?.moments.map((m) => `${m.title} ${m.description ?? ""}`) ?? [])].filter(Boolean).join(" ");
      const s = score(text, c.title, q);
      if (s >= 0) moments.push({ trip: t, cp: c, score: s });
    }
  }
  moments.sort((a, b) => a.score - b.score || momentDate(b.trip, b.cp).localeCompare(momentDate(a.trip, a.cp)));
  return { trips: tripHits, moments: moments.slice(0, 40) };
}

/** Самые частые реальные места пользователя (по подписи места или названию момента). */
export function popularPlaces(trips: Trip[], limit = 8) {
  const map = new Map<string, { name: string; count: number; trip: Trip; cp: Checkpoint }>();
  for (const t of trips) {
    for (const c of t.checkpoints) {
      const name = (c.location?.label ?? "").split(",")[0].trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { name, count: 1, trip: t, cp: c });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

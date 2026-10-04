/** Достижения: считаются только по реальным данным — моментам, поездкам, км, фото, меткам. */
import { hasCoords, isEvent, momentDate, tripDays, tripKm, tripMediaIds } from "./stats";
import type { MediaItem, Trip, UserData } from "./types";

export type Achievement = { id: string; icon: string; title: string; text: string; value: number; goal: number; done: boolean };

const city = (label?: string) => {
  const p = (label ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return p.length >= 3 ? p[1] : p[0];
};

export function computeAchievements(trips: Trip[], metas: MediaItem[], user: UserData | null): Achievement[] {
  const moments = trips.flatMap((t) => t.checkpoints.map((c) => ({ t, c })));
  const tripList = trips.filter((t) => !isEvent(t));
  const events = trips.filter(isEvent);
  const km = tripList.reduce((s, t) => s + (tripKm(t) ?? 0), 0);
  const photos = metas.filter((m) => m.kind === "image").length;
  const videos = metas.filter((m) => m.kind === "video").length;
  const cities = new Set(moments.filter(({ c }) => hasCoords(c) || c.location?.label).map(({ c }) => city(c.location?.label)).filter(Boolean));
  const tags = new Set(moments.flatMap(({ c }) => c.meta?.tags ?? []));
  const longest = Math.max(0, ...tripList.map(tripDays));
  const early = moments.some(({ c }) => c.time && c.time < "06:00");
  const late = moments.some(({ c }) => c.time && c.time >= "23:00");
  const byYearMonth = new Map<string, Set<string>>();
  for (const { t, c } of moments) {
    const d = momentDate(t, c);
    if (!byYearMonth.has(d.slice(0, 4))) byYearMonth.set(d.slice(0, 4), new Set());
    byYearMonth.get(d.slice(0, 4))!.add(d.slice(5, 7));
  }
  const fullYear = Math.max(0, ...Array.from(byYearMonth.values()).map((s) => s.size));
  const rated = trips.filter((t) => t.meta?.rating).length;
  const wishesDone = (user?.wishes ?? []).filter((w) => w.doneTripId).length;
  const gpx = trips.some((t) => t.route?.provider === "gpx");
  const moods = new Set(moments.map(({ c }) => c.meta?.mood).filter(Boolean)).size;

  const list: Omit<Achievement, "done">[] = [
    { id: "m1", icon: "✨", title: "Первый момент", text: "Сохранить первое воспоминание", value: moments.length, goal: 1 },
    { id: "m50", icon: "📚", title: "Летописец", text: "50 моментов в истории", value: moments.length, goal: 50 },
    { id: "m200", icon: "🏛", title: "Хранитель памяти", text: "200 моментов", value: moments.length, goal: 200 },
    { id: "t1", icon: "🎒", title: "В путь!", text: "Первая поездка", value: tripList.length, goal: 1 },
    { id: "t10", icon: "🧭", title: "Путешественник", text: "10 поездок", value: tripList.length, goal: 10 },
    { id: "t25", icon: "🌍", title: "Бывалый", text: "25 поездок", value: tripList.length, goal: 25 },
    { id: "e10", icon: "🎉", title: "Жизнь вокруг", text: "10 событий", value: events.length, goal: 10 },
    { id: "km100", icon: "🚶", title: "Сотня", text: "100 км в поездках", value: Math.round(km), goal: 100 },
    { id: "km1000", icon: "🚆", title: "Тысячник", text: "1000 км в поездках", value: Math.round(km), goal: 1000 },
    { id: "km10000", icon: "✈️", title: "Дальние дороги", text: "10 000 км в поездках", value: Math.round(km), goal: 10000 },
    { id: "c5", icon: "🏙", title: "Пять городов", text: "Моменты в 5 разных городах", value: cities.size, goal: 5 },
    { id: "c20", icon: "🗺", title: "Знаток России", text: "Моменты в 20 разных городах", value: cities.size, goal: 20 },
    { id: "p100", icon: "📷", title: "Фотограф", text: "100 фото", value: photos, goal: 100 },
    { id: "p1000", icon: "🎞", title: "Фотоархив", text: "1000 фото", value: photos, goal: 1000 },
    { id: "v10", icon: "🎬", title: "Режиссёр", text: "10 видео", value: videos, goal: 10 },
    { id: "d7", icon: "🏕", title: "Неделя в пути", text: "Поездка на 7 дней и больше", value: longest, goal: 7 },
    { id: "y12", icon: "📅", title: "Целый год", text: "Моменты в каждом месяце одного года", value: fullYear, goal: 12 },
    { id: "tags5", icon: "🏷", title: "Порядок во всём", text: "5 разных меток", value: tags.size, goal: 5 },
    { id: "moods5", icon: "🎭", title: "Палитра чувств", text: "5 разных настроений", value: moods, goal: 5 },
    { id: "early", icon: "🌅", title: "Ранняя пташка", text: "Момент до 6 утра", value: early ? 1 : 0, goal: 1 },
    { id: "late", icon: "🌙", title: "Сова", text: "Момент после 23:00", value: late ? 1 : 0, goal: 1 },
    { id: "rate5", icon: "⭐", title: "Критик", text: "Оценить 5 поездок", value: rated, goal: 5 },
    { id: "wish", icon: "🎯", title: "Мечта сбылась", text: "Съездить туда, куда хотелось", value: wishesDone, goal: 1 },
    { id: "gpx", icon: "🛰", title: "Точный трек", text: "Загрузить трек GPX", value: gpx ? 1 : 0, goal: 1 },
  ];
  return list.map((a) => ({ ...a, value: Math.min(a.value, a.goal), done: a.value >= a.goal }));
}

export const allMediaIds = (trips: Trip[]) => Array.from(new Set(trips.flatMap(tripMediaIds)));

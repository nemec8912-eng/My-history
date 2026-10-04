/**
 * Адреса страниц. Используются query-параметры (а не /trip/[id]),
 * чтобы сайт собирался в статические файлы и работал на любом хостинге
 * (GitHub Pages, Netlify, Cloudflare Pages, Vercel).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const routes = {
  home: "/",
  trip: (id: string) => `/trip/?id=${encodeURIComponent(id)}`,
  place: (tripId: string, cpId: string) => `/place/?trip=${encodeURIComponent(tripId)}&cp=${encodeURIComponent(cpId)}`,
  moment: (tripId: string, cpId: string) => `/moment/?trip=${encodeURIComponent(tripId)}&cp=${encodeURIComponent(cpId)}`,
  newMoment: (tripId?: string) => (tripId ? `/new/?trip=${encodeURIComponent(tripId)}` : "/new/"),
  map: "/map/",
  timeline: "/timeline/",
  photos: "/photos/",
  videos: "/videos/",
  search: "/search/",
  me: "/me/",
  importPhotos: "/import/",
  quick: "/new/?quick=1",
  year: (y?: string) => (y ? `/year/?y=${y}` : "/year/"),
  recap: (tripId: string) => `/recap/?trip=${encodeURIComponent(tripId)}`,
  trash: "/trash/",
  stats: "/stats/",
};

/** Абсолютный путь к файлу из public/ с учётом basePath. */
export const asset = (path: string) => `${BASE_PATH}${path}`;

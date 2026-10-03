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
};

/** Абсолютный путь к файлу из public/ с учётом basePath. */
export const asset = (path: string) => `${BASE_PATH}${path}`;

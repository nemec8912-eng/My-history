/* Service worker «Моя история»: приложение открывается без сети.
   Данные поездок и фото хранятся в IndexedDB, здесь кэшируется только оболочка сайта. */
const CACHE = "my-history-v3";
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const PAGES = ["/", "/trip/", "/place/", "/moment/", "/new/", "/map/", "/timeline/", "/photos/", "/videos/", "/search/", "/me/"].map((p) => BASE + p);
const PRECACHE = [...PAGES, BASE + "/icons/icon-192.png", BASE + "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase и прочее — напрямую

  // Неизменяемая статика: сначала кэш.
  if (url.pathname.includes("/_next/static/") || url.pathname.includes("/icons/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    return;
  }

  // Страницы и данные страниц: сначала сеть, без сети — кэш (query-параметры не важны).
  event.respondWith(
    fetch(req)
      .then((res) => put(req, res))
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === "navigate" ? caches.match(BASE + "/") : undefined))
          .then((hit) => hit || Response.error())
      )
  );
});

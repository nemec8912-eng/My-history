/* Service worker «Моя история»: приложение открывается без сети.
   Данные поездок и фото хранятся в IndexedDB, здесь кэшируется только оболочка сайта. */
const CACHE = "my-history-v5";
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const PAGES = ["/", "/trip/", "/place/", "/moment/", "/new/", "/map/", "/timeline/", "/photos/", "/videos/", "/search/", "/me/", "/import/", "/trash/", "/stats/", "/year/", "/recap/"].map((p) => BASE + p);
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

/* ───── «Этот день»: ежедневное напоминание (Android/Chrome — фоновая проверка раз в день) ───── */

function idbGet(key) {
  return new Promise((resolve) => {
    const open = indexedDB.open("my-history");
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction("kv", "readonly");
        const r = tx.objectStore("kv").get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      } catch (e) {
        resolve(undefined);
      }
    };
  });
}

function idbSet(key, value) {
  return new Promise((resolve) => {
    const open = indexedDB.open("my-history");
    open.onerror = () => resolve();
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    };
  });
}

async function checkThisDay() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if ((await idbGet("this-day-notified")) === today) return;
  const md = today.slice(5);
  const all = [...((await idbGet("trips")) || []), ...((await idbGet("trips-cloud-cache")) || [])];
  const seen = new Set();
  const hits = [];
  for (const t of all) {
    if (!t || seen.has(t.id) || (t.meta && t.meta.deletedAt)) continue;
    seen.add(t.id);
    const dates = [t.date, ...(t.checkpoints || []).map((c) => c.meta && c.meta.date)].filter(Boolean);
    const d = dates.find((x) => x.slice(5) === md && x.slice(0, 4) < today.slice(0, 4));
    if (d) hits.push({ t, years: Number(today.slice(0, 4)) - Number(d.slice(0, 4)) });
  }
  if (!hits.length) return;
  hits.sort((a, b) => b.years - a.years);
  const h = hits[0];
  const word = h.years % 10 === 1 && h.years % 100 !== 11 ? "год" : [2, 3, 4].includes(h.years % 10) && ![12, 13, 14].includes(h.years % 100) ? "года" : "лет";
  await self.registration.showNotification("Этот день", {
    body: `${h.years} ${word} назад: ${h.t.title}${hits.length > 1 ? ` и ещё ${hits.length - 1}` : ""}`,
    icon: BASE + "/icons/icon-192.png",
    badge: BASE + "/icons/icon-192.png",
    tag: "this-day",
    data: { url: BASE + "/trip/?id=" + encodeURIComponent(h.t.id) },
  });
  await idbSet("this-day-notified", today);
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "this-day") event.waitUntil(checkThisDay());
});

self.addEventListener("message", (event) => {
  if (event.data === "check-this-day") event.waitUntil(checkThisDay());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || BASE + "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    })
  );
});

/**
 * «Поделиться»: одна поездка или событие — в виде отдельной HTML-страницы со своими фото.
 * Файл открывается в любом браузере без входа и без доступа к остальной истории.
 * Ничего не публикуется в интернете: файл отправляете вы сами (мессенджер, почта, «Файлы»).
 */
import { blobToDataUrl, saveFile, shrinkImage } from "./download";
import { getMediaMeta, getMediaUrl } from "./media/store";
import { hasCoords, momentDate, tripDateRange, tripKm, fmtKm, isEvent } from "./stats";
import type { Trip } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const nice = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return y ? `${day} ${RU_MONTHS_GEN[m - 1]} ${y}` : d;
};

const MAX_PHOTOS = 40;

async function photo(id: string): Promise<string | null> {
  const meta = await getMediaMeta(id).catch(() => null);
  if (meta && meta.kind !== "image") {
    // Видео: в файл кладём только кадр-превью.
    const t = await getMediaUrl(id, "thumb").catch(() => null);
    return t ? blobToDataUrl(await (await fetch(t)).blob()) : null;
  }
  const url = (await getMediaUrl(id, "original").catch(() => null)) ?? (await getMediaUrl(id, "thumb").catch(() => null));
  if (!url) return null;
  const b = await shrinkImage(url, 1280, 0.8);
  return b ? blobToDataUrl(b) : null;
}

export async function buildTripHtml(trip: Trip, onProgress?: (s: string) => void): Promise<string> {
  let used = 0;
  const parts: string[] = [];
  const km = tripKm(trip);
  for (const [i, c] of trip.checkpoints.entries()) {
    onProgress?.(`Готовлю ${i + 1} из ${trip.checkpoints.length}…`);
    const ids = c.mediaIds.length ? c.mediaIds : c.coverMediaId ? [c.coverMediaId] : [];
    const imgs: string[] = [];
    for (const id of ids) {
      if (used >= MAX_PHOTOS) break;
      const meta = await getMediaMeta(id).catch(() => null);
      if (meta?.kind === "audio") continue;
      const src = await photo(id);
      if (src) {
        imgs.push(`<img src="${src}" alt="" loading="lazy">`);
        used++;
      }
    }
    const place = c.location?.label;
    const map = hasCoords(c) ? `https://www.openstreetmap.org/?mlat=${c.location!.lat}&mlon=${c.location!.lon}#map=15/${c.location!.lat}/${c.location!.lon}` : null;
    parts.push(`<section class="m">
  <div class="when">${esc(nice(momentDate(trip, c)))}${c.time ? `, ${esc(c.time)}` : ""}</div>
  <h2>${c.icon ? esc(c.icon) + " " : ""}${esc(c.title)}</h2>
  ${place ? `<div class="place">📍 ${map ? `<a href="${map}">${esc(place)}</a>` : esc(place)}</div>` : ""}
  ${c.description ? `<p>${esc(c.description).replace(/\n/g, "<br>")}</p>` : ""}
  ${c.meta?.tags?.length ? `<div class="tags">${c.meta.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
  ${imgs.length ? `<div class="ph${imgs.length === 1 ? " one" : ""}">${imgs.join("")}</div>` : ""}
</section>`);
  }
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(trip.title)} — Моя история</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0a0d14;color:#e8eefc;font:16px/1.5 -apple-system,"SF Pro Text",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}header{margin-bottom:20px}
.kind{display:inline-block;font-size:12px;font-weight:700;color:#8fb4ff;background:rgba(47,123,255,.15);padding:3px 10px;border-radius:99px}
h1{font-size:30px;line-height:1.15;margin:10px 0 6px}.sub{color:#9aa3b2}
.m{background:#151a24;border:1px solid #232a38;border-radius:18px;padding:16px;margin:14px 0}
.m h2{margin:2px 0 6px;font-size:20px}.when{color:#9aa3b2;font-size:13px;font-weight:600}
.place{color:#b9c6dd;font-size:14px;margin-bottom:6px}.place a{color:#8fb4ff;text-decoration:none}
.m p{margin:8px 0}.tags span{display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,.07);font-size:13px;font-weight:700}
.ph{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.ph.one{grid-template-columns:1fr}
.ph img{width:100%;border-radius:12px;display:block;aspect-ratio:4/3;object-fit:cover}.ph.one img{aspect-ratio:auto}
footer{color:#6c7586;font-size:13px;text-align:center;margin-top:30px}
</style></head><body><main>
<header><span class="kind">${isEvent(trip) ? "Событие" : "Поездка"}</span><h1>${esc(trip.title)}</h1>
<div class="sub">${esc(tripDateRange(trip))}${trip.place ? ` · ${esc(trip.place)}` : ""}${km && km >= 0.1 && !isEvent(trip) ? ` · ${fmtKm(km)} км` : ""}</div>
${trip.description ? `<p>${esc(trip.description)}</p>` : ""}</header>
${parts.join("\n")}
<footer>Из личного дневника «Моя история»</footer>
</main></body></html>`;
}

export async function shareTripHtml(trip: Trip, onProgress?: (s: string) => void) {
  const html = await buildTripHtml(trip, onProgress);
  const safe = trip.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "история";
  await saveFile(new Blob([html], { type: "text/html" }), `${safe}.html`, { share: true, title: trip.title });
}

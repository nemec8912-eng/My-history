/** Коллаж-открытка из фото поездки: 4, 6 или 9 снимков, название и даты. Рисуется на телефоне. */
import { getMediaMeta, getMediaUrl } from "./media/store";
import { tripDateRange } from "./stats";
import type { Trip } from "./types";

export type CollageFormat = "post" | "story";
export type CollageLayout = 4 | 6 | 9;

/** Лучшие фото поездки: обложки важных моментов, затем остальные. */
export async function collagePhotoIds(trip: Trip, count: number): Promise<string[]> {
  const ordered = [...trip.checkpoints].sort((a, b) => b.importance - a.importance);
  const ids: string[] = [];
  for (const c of ordered) for (const id of [c.coverMediaId, ...c.mediaIds]) if (id && !ids.includes(id)) ids.push(id);
  // Фото, добавленные к поездке целиком.
  for (const id of [trip.coverMediaId, ...trip.mediaIds]) if (id && !ids.includes(id)) ids.push(id);
  const out: string[] = [];
  for (const id of ids) {
    if (out.length >= count) break;
    const m = await getMediaMeta(id).catch(() => null);
    if (m?.kind === "image" || m?.kind === "video") out.push(id);
  }
  return out;
}

async function img(id: string): Promise<HTMLImageElement | null> {
  const meta = await getMediaMeta(id).catch(() => null);
  const url = meta?.kind === "video" ? await getMediaUrl(id, "thumb") : (await getMediaUrl(id, "original")) ?? (await getMediaUrl(id, "thumb"));
  if (!url) return null;
  const i = new Image();
  i.src = url;
  try {
    await i.decode();
    return i;
  } catch {
    return null;
  }
}

function cover(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

export async function drawCollage(canvas: HTMLCanvasElement, trip: Trip, ids: string[], format: CollageFormat): Promise<void> {
  const W = 1080;
  const H = format === "story" ? 1920 : 1350;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a0d14";
  ctx.fillRect(0, 0, W, H);
  const images = (await Promise.all(ids.map(img))).filter(Boolean) as HTMLImageElement[];
  const n = images.length;
  const pad = 14;
  const head = format === "story" ? 300 : 210;
  const gridH = H - head - pad;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(n / cols));
  const cw = (W - pad * (cols + 1)) / cols;
  const ch = (gridH - pad * rows) / rows;
  images.forEach((im, i) => {
    const r = Math.floor(i / cols);
    // последняя неполная строка — растягиваем по ширине
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const c = i % cols;
    const w = (W - pad * (inRow + 1)) / inRow;
    const x = pad + c * (w + pad);
    const y = pad + r * (ch + pad);
    ctx.save();
    const rad = 22;
    ctx.beginPath();
    ctx.roundRect(x, y, inRow === cols ? cw : w, ch, rad);
    ctx.clip();
    cover(ctx, im, x, y, inRow === cols ? cw : w, ch);
    ctx.restore();
  });
  const g = ctx.createLinearGradient(0, H - head, 0, H);
  g.addColorStop(0, "#0a0d14");
  g.addColorStop(1, "#111a2e");
  ctx.fillStyle = g;
  ctx.fillRect(0, H - head, W, head);
  ctx.fillStyle = "#fff";
  ctx.font = "800 64px -apple-system, 'SF Pro Display', Roboto, sans-serif";
  let title = trip.title;
  while (ctx.measureText(title).width > W - 120 && title.length > 4) title = title.slice(0, -2);
  if (title !== trip.title) title += "…";
  ctx.fillText(title, 60, H - head + (format === "story" ? 120 : 95));
  ctx.font = "500 36px -apple-system, Roboto, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.fillText([tripDateRange(trip), trip.place].filter(Boolean).join(" · "), 60, H - head + (format === "story" ? 185 : 150));
  ctx.font = "700 26px -apple-system, Roboto, sans-serif";
  ctx.fillStyle = "#8fb4ff";
  ctx.textAlign = "right";
  ctx.fillText("Моя история", W - 50, H - 40);
  ctx.textAlign = "left";
}

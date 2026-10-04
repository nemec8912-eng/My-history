"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { saveFile } from "@/lib/download";
import { getMediaMeta, getMediaUrl } from "@/lib/media/store";
import { routes } from "@/lib/routes";
import { fmtKm, isEvent, momentDate, tripDateRange, tripKm } from "@/lib/stats";
import { useTrip } from "@/lib/useTrip";
import type { Trip } from "@/lib/types";

const W = 720;
const H = 1280;
const FADE = 0.6;
const MAX_PHOTOS = 40;
const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const nice = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return y ? `${day} ${RU_MONTHS_GEN[m - 1]} ${y}` : d;
};

type Slide =
  | { kind: "title"; dur: number; img?: HTMLImageElement }
  | { kind: "photo"; dur: number; img: HTMLImageElement; title: string; sub: string }
  | { kind: "end"; dur: number; img?: HTMLImageElement };

async function loadImage(id: string): Promise<HTMLImageElement | null> {
  const meta = await getMediaMeta(id).catch(() => null);
  if (meta && meta.kind !== "image") return null;
  const url = (await getMediaUrl(id, "original").catch(() => null)) ?? (await getMediaUrl(id, "thumb").catch(() => null));
  if (!url) return null;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

async function buildSlides(trip: Trip, onProgress: (n: number, total: number) => void): Promise<Slide[]> {
  const items: { id: string; title: string; sub: string }[] = [];
  for (const c of trip.checkpoints) {
    const ids = Array.from(new Set([c.coverMediaId, ...c.mediaIds].filter(Boolean) as string[])).slice(0, 4);
    const place = c.location?.label?.split(",").slice(0, 2).join(",");
    for (const id of ids) items.push({ id, title: c.title, sub: [nice(momentDate(trip, c)) + (c.time ? `, ${c.time}` : ""), place].filter(Boolean).join(" · ") });
  }
  const picked = items.slice(0, MAX_PHOTOS);
  const slides: Slide[] = [];
  let n = 0;
  for (const it of picked) {
    onProgress(++n, picked.length);
    const img = await loadImage(it.id);
    if (img) slides.push({ kind: "photo", dur: 2.8, img, title: it.title, sub: it.sub });
  }
  const firstImg = slides.find((s) => s.kind === "photo")?.img;
  const lastImg = [...slides].reverse().find((s) => s.kind === "photo")?.img;
  return [{ kind: "title", dur: 3, img: firstImg }, ...slides, { kind: "end", dur: 3.2, img: lastImg }];
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, zoom: number, panX: number, panY: number) {
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  ctx.drawImage(img, (W - w) / 2 + panX, (H - h) / 2 + panY, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines = 3): number {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = w;
      if (++lines >= maxLines - 1) break;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}

function drawSlide(ctx: CanvasRenderingContext2D, s: Slide, local: number, index: number, trip: Trip, photos: number) {
  const p = Math.min(1, local / s.dur);
  ctx.fillStyle = "#0a0d14";
  ctx.fillRect(0, 0, W, H);
  if (s.img) {
    const dir = index % 2 ? 1 : -1;
    cover(ctx, s.img, 1.04 + 0.1 * p, dir * 30 * (p - 0.5), -dir * 20 * (p - 0.5));
  }
  if (s.kind === "photo") {
    const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.78)");
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.6, W, H * 0.4);
    ctx.fillStyle = "#fff";
    ctx.font = "800 48px -apple-system, 'SF Pro Display', Roboto, sans-serif";
    const y = wrap(ctx, s.title, 48, H - 170, W - 96, 56, 2);
    ctx.font = "500 28px -apple-system, Roboto, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.82)";
    wrap(ctx, s.sub, 48, Math.max(y, H - 100), W - 96, 34, 2);
    return;
  }
  ctx.fillStyle = "rgba(6,9,16,.62)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  if (s.kind === "title") {
    ctx.font = "700 28px -apple-system, Roboto, sans-serif";
    ctx.fillStyle = "#8fb4ff";
    ctx.fillText(isEvent(trip) ? "СОБЫТИЕ" : "ПОЕЗДКА", W / 2, H / 2 - 140);
    ctx.fillStyle = "#fff";
    ctx.font = "800 64px -apple-system, 'SF Pro Display', Roboto, sans-serif";
    const y = wrap(ctx, trip.title, W / 2, H / 2 - 60, W - 100, 74, 3);
    ctx.font = "500 32px -apple-system, Roboto, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillText(tripDateRange(trip), W / 2, y + 10);
  } else {
    const km = tripKm(trip);
    ctx.font = "800 56px -apple-system, 'SF Pro Display', Roboto, sans-serif";
    ctx.fillText(trip.title, W / 2, H / 2 - 80, W - 80);
    ctx.font = "600 34px -apple-system, Roboto, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.9)";
    const facts = [
      `${trip.checkpoints.length} ${trip.checkpoints.length % 10 === 1 && trip.checkpoints.length % 100 !== 11 ? "момент" : "моментов"}`,
      `${photos} фото`,
      km && km >= 0.1 && !isEvent(trip) ? `${fmtKm(km)} км` : null,
    ].filter(Boolean);
    ctx.fillText(facts.join(" · "), W / 2, H / 2, W - 80);
    ctx.font = "600 26px -apple-system, Roboto, sans-serif";
    ctx.fillStyle = "#8fb4ff";
    ctx.fillText("Моя история", W / 2, H - 90);
  }
  ctx.textAlign = "left";
}

/** Видео-итог поездки: слайд-шоу из фото с подписями; можно сохранить как видеофайл. */
function Recap() {
  const id = useSearchParams().get("trip") ?? undefined;
  const { trip, status } = useTrip(id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [loading, setLoading] = useState("Готовлю фото…");
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const startAt = useRef(0);
  const offset = useRef(0);

  const total = useMemo(() => (slides ?? []).reduce((s, x) => s + x.dur, 0), [slides]);
  const photos = (slides ?? []).filter((s) => s.kind === "photo").length;

  useEffect(() => {
    if (!trip) return;
    let alive = true;
    buildSlides(trip, (n, t) => alive && setLoading(`Готовлю фото ${n} из ${t}…`)).then((s) => {
      if (!alive) return;
      setSlides(s);
      setLoading("");
    });
    return () => {
      alive = false;
    };
  }, [trip]);

  function frame(t: number) {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !slides || !trip) return;
    let acc = 0;
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      if (t < acc + s.dur || i === slides.length - 1) {
        const local = t - acc;
        drawSlide(ctx, s, local, i, trip, photos);
        // Плавный переход в следующий слайд.
        const next = slides[i + 1];
        if (next && local > s.dur - FADE) {
          ctx.globalAlpha = (local - (s.dur - FADE)) / FADE;
          drawSlide(ctx, next, 0, i + 1, trip, photos);
          ctx.globalAlpha = 1;
        }
        break;
      }
      acc += s.dur;
    }
  }

  useEffect(() => {
    if (slides) frame(0.8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides]);

  function loop(onEnd?: () => void) {
    const t = offset.current + (performance.now() - startAt.current) / 1000;
    frame(Math.min(t, total));
    setProgress(Math.min(1, t / total));
    if (t >= total) {
      setPlaying(false);
      offset.current = 0;
      onEnd?.();
      return;
    }
    raf.current = requestAnimationFrame(() => loop(onEnd));
  }

  function play() {
    if (playing) {
      cancelAnimationFrame(raf.current);
      offset.current += (performance.now() - startAt.current) / 1000;
      setPlaying(false);
      return;
    }
    startAt.current = performance.now();
    setPlaying(true);
    loop();
  }

  async function record() {
    const c = canvas.current;
    if (!c || !trip) return;
    const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
    const type = types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    if (!type || !("captureStream" in c)) return alert("Этот браузер не умеет записывать видео. Попробуйте Chrome или Safari поновее.");
    cancelAnimationFrame(raf.current);
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      setRecording(false);
      const blob = new Blob(chunks, { type: type.split(";")[0] });
      const ext = type.includes("mp4") ? "mp4" : "webm";
      await saveFile(blob, `${trip.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 50) || "итог"}.${ext}`, { title: trip.title });
    };
    setRecording(true);
    offset.current = 0;
    startAt.current = performance.now();
    rec.start(500);
    setPlaying(true);
    loop(() => setTimeout(() => rec.stop(), 300));
  }

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  if (status === "loading") return <main className="shell"><p className="muted">Загрузка…</p></main>;
  if (!trip) return <main className="shell"><p className="muted">Поездка не найдена.</p></main>;

  return (
    <main className="shell recapPage">
      <header className="nmHead">
        <Link href={routes.trip(trip.id)} className="iconBtnPlain" aria-label="Назад">
          <Icon name="back" />
        </Link>
        <h1>Видео-итог</h1>
        <span style={{ width: 40 }} />
      </header>
      <div className="recapStage">
        <canvas ref={canvas} width={W} height={H} onClick={play} />
        {loading && <p className="recapLoading">{loading}</p>}
        <span className="recapProgress">
          <i style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
      {slides && photos === 0 && <p className="muted">В этой поездке пока нет фото для видео.</p>}
      {slides && photos > 0 && (
        <div className="recapActions">
          <button className="softBtn" onClick={play} disabled={recording}>
            {playing && !recording ? "⏸ Пауза" : "▶ Смотреть"}
          </button>
          <button className="primary" onClick={record} disabled={recording}>
            {recording ? `Записываю… ${Math.round(progress * 100)}%` : "Сохранить видео"}
          </button>
        </div>
      )}
      <p className="hint">
        {photos} фото · {Math.round(total)} сек. Видео собирается прямо на телефоне — это занимает столько же времени, сколько длится ролик.
      </p>
    </main>
  );
}

export default function RecapPage() {
  return (
    <Suspense fallback={null}>
      <Recap />
    </Suspense>
  );
}

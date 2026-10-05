"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { saveFile, shrinkImage } from "@/lib/download";
import { plural } from "@/lib/format";
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

/** Кадр слайда загружается только когда он рядом (текущий и следующий) — иначе 40 оригиналов не влезут в память телефона. */
type Media = { src: string; video?: boolean; img?: HTMLImageElement | HTMLVideoElement; loading?: Promise<void> };
type Slide =
  | { kind: "title"; dur: number; media?: Media }
  | { kind: "photo"; dur: number; media: Media; title: string; sub: string }
  | { kind: "end"; dur: number; media?: Media };

function ensure(m?: Media): Promise<void> {
  if (!m || m.img) return Promise.resolve();
  if (m.loading) return m.loading;
  m.loading = new Promise<void>((resolve) => {
    if (m.video) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, 8000);
      v.onloadeddata = () => {
        m.img = v;
        done();
      };
      v.onerror = done;
      v.src = m.src;
    } else {
      const i = new Image();
      i.src = m.src;
      i.decode()
        .then(() => (m.img = i))
        .catch(() => undefined)
        .finally(resolve);
    }
  }).finally(() => (m.loading = undefined));
  return m.loading;
}

function release(m?: Media) {
  if (!m?.img) return;
  if (m.img instanceof HTMLVideoElement) {
    m.img.pause();
    m.img.removeAttribute("src");
    m.img.load();
  }
  m.img = undefined;
}

async function buildSlides(trip: Trip, onProgress: (n: number, total: number) => void): Promise<Slide[]> {
  const items: { id: string; title: string; sub: string }[] = [];
  const seen = new Set<string>();
  for (const c of trip.checkpoints) {
    const ids = Array.from(new Set([c.coverMediaId, ...c.mediaIds].filter(Boolean) as string[])).slice(0, 4);
    const place = c.location?.label?.split(",").slice(0, 2).join(",");
    for (const id of ids) {
      seen.add(id);
      items.push({ id, title: c.title || trip.title, sub: [nice(momentDate(trip, c)) + (c.time ? `, ${c.time}` : ""), place].filter(Boolean).join(" · ") });
    }
  }
  // Фото, добавленные к поездке целиком (вкладки «Фото» / «Видео»).
  for (const id of trip.mediaIds) if (!seen.has(id)) items.push({ id, title: trip.title, sub: tripDateRange(trip) });
  const picked = items.slice(0, MAX_PHOTOS);
  const slides: Slide[] = [];
  let n = 0;
  for (const it of picked) {
    onProgress(++n, picked.length);
    const meta = await getMediaMeta(it.id).catch(() => null);
    if (!meta || meta.kind === "audio") continue;
    if (meta.kind === "video") {
      const src = await getMediaUrl(it.id, "original").catch(() => null);
      if (src) slides.push({ kind: "photo", dur: Math.max(2, Math.min(6, meta.duration ?? 4)), media: { src, video: true }, title: it.title, sub: it.sub });
      continue;
    }
    // Уменьшенная копия (1280 px) — лёгкая для памяти и достаточная для ролика 720×1280.
    const url = (await getMediaUrl(it.id, "original").catch(() => null)) ?? (await getMediaUrl(it.id, "thumb").catch(() => null));
    const small = url ? await shrinkImage(url, 1280, 0.85) : null;
    if (small) slides.push({ kind: "photo", dur: 2.8, media: { src: URL.createObjectURL(small) }, title: it.title, sub: it.sub });
  }
  const stills = slides.filter((s): s is Extract<Slide, { kind: "photo" }> => s.kind === "photo" && !s.media.video).map((s) => s.media.src);
  const first = stills[0];
  const last = stills[stills.length - 1];
  return [{ kind: "title", dur: 3, media: first ? { src: first } : undefined }, ...slides, { kind: "end", dur: 3.2, media: last ? { src: last } : undefined }];
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLVideoElement, zoom: number, panX: number, panY: number) {
  const iw = img instanceof HTMLVideoElement ? img.videoWidth : img.naturalWidth;
  const ih = img instanceof HTMLVideoElement ? img.videoHeight : img.naturalHeight;
  const k = Math.max(W / iw, H / ih) * zoom;
  const w = iw * k;
  const h = ih * k;
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
  const img = s.media?.img;
  if (img instanceof HTMLVideoElement) {
    const v = img;
    // Держим кадр видео в такт ролику.
    if (Math.abs(v.currentTime - local) > 0.35) v.currentTime = Math.min(local, (v.duration || local) - 0.05);
    if (v.paused && local > 0.05 && local < s.dur) void v.play().catch(() => undefined);
    cover(ctx, v, 1, 0, 0);
  } else if (img) {
    const dir = index % 2 ? 1 : -1;
    cover(ctx, img, 1.04 + 0.1 * p, dir * 30 * (p - 0.5), -dir * 20 * (p - 0.5));
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
      `${trip.checkpoints.length} ${plural(trip.checkpoints.length, "момент", "момента", "моментов")}`,
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
  const pauseVideos = () => (slides ?? []).forEach((s) => s.media?.img instanceof HTMLVideoElement && s.media.img.pause());

  useEffect(() => {
    if (!trip) return;
    let alive = true;
    let built: Slide[] = [];
    buildSlides(trip, (n, t) => alive && setLoading(`Готовлю фото ${n} из ${t}…`)).then(async (s) => {
      built = s;
      if (!alive) return;
      await Promise.all([ensure(s[0]?.media), ensure(s[1]?.media)]);
      setSlides(s);
      setLoading("");
    });
    return () => {
      alive = false;
      built.forEach((x) => {
        release(x.media);
        if (x.kind === "photo" && !x.media.video) URL.revokeObjectURL(x.media.src);
      });
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
        // Держим в памяти только соседние кадры.
        void ensure(s.media);
        void ensure(slides[i + 1]?.media);
        slides.forEach((x, j) => {
          if ((j < i - 1 || j > i + 2) && x.media !== s.media && x.media !== slides[i + 1]?.media) release(x.media);
        });
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
      pauseVideos();
      setPlaying(false);
      offset.current = 0;
      onEnd?.();
      return;
    }
    raf.current = requestAnimationFrame(() => loop(onEnd));
  }

  async function play() {
    if (recording) return;
    if (playing) {
      cancelAnimationFrame(raf.current);
      offset.current += (performance.now() - startAt.current) / 1000;
      pauseVideos();
      setPlaying(false);
      return;
    }
    await Promise.all([ensure(slides?.[0]?.media), ensure(slides?.[1]?.media)]);
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
    pauseVideos();
    await Promise.all([ensure(slides?.[0]?.media), ensure(slides?.[1]?.media)]);
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
        <canvas ref={canvas} width={W} height={H} onClick={() => !recording && void play()} />
        {loading && <p className="recapLoading">{loading}</p>}
        <span className="recapProgress">
          <i style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
      {slides && photos === 0 && <p className="muted">В этой поездке пока нет фото или видео для ролика.</p>}
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
        {photos} {plural(photos, "кадр", "кадра", "кадров")} · {Math.round(total)} сек. Видео собирается прямо на телефоне — это занимает столько же времени, сколько длится ролик.
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

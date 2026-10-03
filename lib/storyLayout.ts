/**
 * Раскладка режима «История».
 *
 * Географические координаты НЕ переносятся на экран один к одному: экран строится
 * из порядка точек и их свойств (важность, размер, фото, расстояние между точками).
 * Результат детерминирован: случайность берётся из seed = tripId + pointId,
 * поэтому после перезагрузки поездка выглядит так же, а добавление одной точки
 * не перестраивает весь маршрут.
 */
import { haversineKm } from "./format";
import { SIZES } from "./markerStyle";
import type { Checkpoint, Trip } from "./types";

export type Side = "left" | "right";

export type StoryNode = {
  cp: Checkpoint;
  index: number;
  x: number;
  y: number;
  /** Диаметр маркера в px. */
  d: number;
  /** С какой стороны от маркера стоит карточка. */
  side: Side;
  /** Фото показывается внутри маркера. */
  photoMarker: boolean;
};

export type StorySegment = {
  id: string;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  colorA: string;
  colorB: string;
};

export type StoryLayout = {
  nodes: StoryNode[];
  segments: StorySegment[];
  fullPath: string;
  width: number;
  height: number;
  labelWidth: number;
};

type P = { x: number; y: number };

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — маленький детерминированный генератор. */
export function seeded(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

export function markerDiameter(cp: Checkpoint, hasPhoto: boolean): number {
  let d = SIZES[cp.style.size]?.px ?? 36;
  d *= 1 + clamp(cp.importance, 0, 3) * 0.08;
  if (hasPhoto && cp.style.showPhoto) d = Math.max(d, 52);
  if (cp.kind === "start") d = Math.max(d, 48);
  if (cp.kind === "end") d = Math.max(d, 74);
  return Math.round(d);
}

export function layoutStory(trip: Trip, width: number, hasCover: (cp: Checkpoint) => boolean): StoryLayout {
  const W = Math.max(280, Math.round(width));
  const pad = 12;
  const gapLabel = 10;
  const labelWidth = Math.round(clamp(W * 0.44, 132, 250));
  const cps = trip.checkpoints;
  const n = cps.length;
  const nodes: StoryNode[] = [];

  const tripRand = seeded(trip.id);
  let half: Side = tripRand() < 0.5 ? "left" : "right";
  let y = 0;

  for (let i = 0; i < n; i++) {
    const cp = cps[i];
    const rand = seeded(`${trip.id}:${cp.id}`);
    const photo = hasCover(cp);
    const d = markerDiameter(cp, photo);

    // Сторона экрана: чаще чередуется, иногда несколько точек подряд остаются на одной стороне.
    const prevHalf = half;
    if (i > 0) {
      const flipChance = n > 12 ? 0.68 : 0.78;
      if (rand() < flipChance || cp.kind === "end") half = half === "left" ? "right" : "left";
    }

    // Насколько далеко от центра: важные точки и точки с фото уходят к краю смелее.
    const important = cp.importance >= 2 || cp.kind !== "regular";
    const roll = rand();
    const depth = important
      ? 0.5 + roll * 0.5
      : photo
        ? 0.35 + roll * 0.55
        : roll < 0.4
          ? 0.72 + rand() * 0.28
          : 0.1 + rand() * 0.55;

    const minX = pad + d / 2;
    const maxX = W - pad - d / 2;
    let x: number;
    let side: Side;
    if (half === "left") {
      side = "right";
      const hi = Math.max(minX, W - pad - labelWidth - gapLabel - d / 2);
      x = hi - (hi - minX) * depth;
    } else {
      side = "left";
      const lo = Math.min(maxX, pad + labelWidth + gapLabel + d / 2);
      x = lo + (maxX - lo) * depth;
    }

    if (i === 0) {
      y = 20 + Math.max(d / 2, 48);
    } else {
      const prev = nodes[i - 1];
      let gap = 62 + (prev.d + d) / 2 + rand() * 54;
      const a = cps[i - 1].location;
      const b = cp.location;
      if (a && b) gap += Math.min(80, Math.log2(1 + haversineKm(a, b)) * 13);
      if (photo || hasCover(cps[i - 1])) gap += 10;
      if (cp.kind === "end") gap += 34;
      if (half === prevHalf) gap = Math.max(gap, 124);
      y += Math.max(gap, 100);
    }

    nodes.push({ cp, index: i, x: r1(x), y: r1(y), d, side, photoMarker: photo && cp.style.showPhoto });
  }

  // Узлы линии: точки маршрута + невидимые «отклонения», чтобы путь гулял по экрану.
  const pts: P[] = [];
  const realIdx: number[] = [];
  nodes.forEach((b, i) => {
    if (i > 0) {
      const a = nodes[i - 1];
      const rand = seeded(`${trip.id}:wander:${b.cp.id}`);
      const dy = b.y - a.y;
      const sameHalf = a.x < W / 2 === b.x < W / 2;
      if (dy > 150 || sameHalf || rand() < 0.3) {
        let wx: number;
        if (sameHalf) wx = a.x < W / 2 ? W * (0.6 + rand() * 0.3) : W * (0.1 + rand() * 0.3);
        else wx = (a.x + b.x) / 2 + (rand() - 0.5) * W * 0.55;
        pts.push({ x: r1(clamp(wx, pad + 4, W - pad - 4)), y: r1(a.y + dy * (0.38 + rand() * 0.24)) });
      }
    }
    realIdx.push(pts.length);
    pts.push({ x: b.x, y: b.y });
  });

  // Catmull-Rom → кубические кривые Безье (гладкая линия через все узлы).
  const get = (i: number): P => {
    if (i < 0) return { x: pts[0].x, y: pts[0].y - 90 };
    if (i >= pts.length) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y + 90 };
    return pts[i];
  };
  // У настоящих точек касательная почти вертикальная: линия сначала уходит вниз,
  // проходит под карточкой и только потом поворачивает в сторону.
  const isReal = new Set(realIdx);
  const k = 1 / 5.5;
  const curve = (i: number) => {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const dy = p2.y - p1.y;
    const a = isReal.has(i);
    const b = isReal.has(i + 1);
    const c1 = {
      x: p1.x + (p2.x - p0.x) * k * (a ? 0.25 : 1),
      y: p1.y + Math.max((p2.y - p0.y) * k, dy * (a ? 0.55 : 0.22)),
    };
    const c2 = {
      x: p2.x - (p3.x - p1.x) * k * (b ? 0.25 : 1),
      y: p2.y - Math.max((p3.y - p1.y) * k, dy * (b ? 0.55 : 0.22)),
    };
    return `C ${r1(c1.x)} ${r1(c1.y)} ${r1(c2.x)} ${r1(c2.y)} ${p2.x} ${p2.y}`;
  };

  const segments: StorySegment[] = [];
  for (let s = 0; s < nodes.length - 1; s++) {
    const from = realIdx[s];
    const to = realIdx[s + 1];
    let d = `M ${pts[from].x} ${pts[from].y}`;
    for (let j = from; j < to; j++) d += " " + curve(j);
    const a = nodes[s];
    const b = nodes[s + 1];
    segments.push({
      id: `${a.cp.id}-${b.cp.id}`,
      d,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      colorA: a.cp.style.color,
      colorB: b.cp.style.color,
    });
  }

  let fullPath = pts.length ? `M ${pts[0].x} ${pts[0].y}` : "";
  for (let j = 0; j < pts.length - 1; j++) fullPath += " " + curve(j);

  const last = nodes[nodes.length - 1];
  const height = last ? Math.ceil(last.y + Math.max(last.d / 2, 56) + 28) : 200;

  return { nodes, segments, fullPath, width: W, height, labelWidth };
}

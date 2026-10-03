import type { Checkpoint, CheckpointKind, MarkerStyle, ShapeId, SizeId } from "./types";

/**
 * Реестр форм контрольных точек. Чтобы добавить новую форму, достаточно
 * добавить ключ в ShapeId (lib/types.ts) и описание сюда.
 * clip — CSS clip-path, чтобы фото-превью красиво вписывалось в форму.
 * svg — контур в системе координат 0..100.
 */
export const SHAPES: Record<ShapeId, { label: string; clip: string; svg: string }> = {
  circle: {
    label: "Круг",
    clip: "circle(50% at 50% 50%)",
    svg: '<circle cx="50" cy="50" r="46"/>',
  },
  square: {
    label: "Квадрат",
    clip: "inset(0 round 18%)",
    svg: '<rect x="5" y="5" width="90" height="90" rx="16"/>',
  },
  triangle: {
    label: "Треугольник",
    clip: "polygon(50% 4%, 97% 92%, 3% 92%)",
    svg: '<polygon points="50,5 96,91 4,91" stroke-linejoin="round"/>',
  },
  diamond: {
    label: "Ромб",
    clip: "polygon(50% 2%, 98% 50%, 50% 98%, 2% 50%)",
    svg: '<polygon points="50,3 97,50 50,97 3,50" stroke-linejoin="round"/>',
  },
  star: {
    label: "Звезда",
    clip: "polygon(50% 3%, 62% 36%, 97% 37%, 69% 58%, 79% 93%, 50% 72%, 21% 93%, 31% 58%, 3% 37%, 38% 36%)",
    svg: '<polygon points="50,4 62,36 96,37 69,58 79,92 50,72 21,92 31,58 4,37 38,36" stroke-linejoin="round"/>',
  },
  hexagon: {
    label: "Шестиугольник",
    clip: "polygon(25% 5%, 75% 5%, 98% 50%, 75% 95%, 25% 95%, 2% 50%)",
    svg: '<polygon points="26,6 74,6 97,50 74,94 26,94 3,50" stroke-linejoin="round"/>',
  },
};

export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];

export const SIZES: Record<SizeId, { label: string; px: number }> = {
  s: { label: "Маленькая", px: 26 },
  m: { label: "Средняя", px: 36 },
  l: { label: "Большая", px: 50 },
  xl: { label: "Очень большая", px: 66 },
};

export const SIZE_IDS = Object.keys(SIZES) as SizeId[];

export const PALETTE = [
  "#633cff", "#2f6bff", "#14a3c7", "#16a36a", "#f2b705",
  "#ff8a1f", "#ef3b4a", "#e0459b", "#262037", "#8a8f9c",
];

export function defaultStyle(kind: CheckpointKind): MarkerStyle {
  if (kind === "start") return { shape: "circle", color: "#16a36a", size: "l", showLabel: true, showPhoto: true };
  if (kind === "end") return { shape: "star", color: "#ef3b4a", size: "xl", showLabel: true, showPhoto: true };
  return { shape: "circle", color: "#633cff", size: "m", showLabel: false, showPhoto: true };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createCheckpoint(kind: CheckpointKind, partial: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: newId(),
    kind,
    title: kind === "start" ? "Начало пути" : kind === "end" ? "Конечная точка" : "Новая точка",
    style: defaultStyle(kind),
    importance: kind === "regular" ? 0 : 2,
    mediaIds: [],
    ...(kind === "end" ? { place: { moments: [] } } : {}),
    ...partial,
  };
}

/** Порядок точек: старт всегда первый, финиш всегда последний, остальные — как задал пользователь. */
export function normalizeOrder(checkpoints: Checkpoint[]): Checkpoint[] {
  const start = checkpoints.filter((c) => c.kind === "start");
  const end = checkpoints.filter((c) => c.kind === "end");
  const mid = checkpoints.filter((c) => c.kind === "regular");
  return [...start, ...mid, ...end];
}

/** Безопасная вставка цвета в HTML/SVG. */
export function safeColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) || /^[a-z]+$/i.test(color) ? color : "#633cff";
}

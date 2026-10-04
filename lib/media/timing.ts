/**
 * Временные замеры этапов загрузки видео (диагностика).
 *
 * Каждый этап пишется в консоль как «[видео abc123] этап +NNN мс (Δ MMM мс)».
 * Сводка по всем файлам: в консоли Safari (Web Inspector) вызвать __uploadTimings().
 * Чтобы отключить вывод в консоль: localStorage.setItem("upload-timing", "0").
 */
import type { MediaId } from "../types";

type Mark = { stage: string; at: number; delta: number };
const starts = new Map<MediaId, number>();
const marks = new Map<MediaId, Mark[]>();
let pickerOpenedAt: number | null = null;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function quiet(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("upload-timing") === "0";
  } catch {
    return false;
  }
}

/** Пользователь нажал «Добавить видео» (открылся системный выбор файла). */
export function notePickerOpened() {
  pickerOpenedAt = now();
}

/**
 * Время от нажатия «Добавить видео» до события change. Включает время, пока пользователь
 * листал галерею, и подготовку файла самой iOS (окно «Подготовка…»/«Сжатие…»), — JS туда не попадает.
 */
export function takePickerDelay(): number | null {
  if (pickerOpenedAt == null) return null;
  const d = now() - pickerOpenedAt;
  pickerOpenedAt = null;
  return d;
}

export function mark(id: MediaId, stage: string, extra?: string) {
  const t = now();
  if (!starts.has(id)) starts.set(id, t);
  const list = marks.get(id) ?? [];
  const at = t - starts.get(id)!;
  const delta = list.length ? at - list[list.length - 1].at : 0;
  list.push({ stage, at, delta });
  marks.set(id, list);
  if (!quiet()) console.info(`[видео ${id.slice(0, 6)}] ${stage} +${Math.round(at)} мс (Δ ${Math.round(delta)} мс)${extra ? " · " + extra : ""}`);
}

export function timings(): Record<string, { stage: string; at: number; delta: number }[]> {
  const out: Record<string, Mark[]> = {};
  marks.forEach((v, k) => (out[k] = v.map((m) => ({ ...m, at: Math.round(m.at), delta: Math.round(m.delta) }))));
  return out;
}

if (typeof window !== "undefined") {
  (window as unknown as { __uploadTimings: typeof timings }).__uploadTimings = timings;
}

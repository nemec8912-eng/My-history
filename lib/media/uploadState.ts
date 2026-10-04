/**
 * Состояние загрузки видео для интерфейса: «Подготовка…», реальный процент, повтор, ошибка.
 * Живёт в памяти вкладки; после перезапуска приложения синхронизация восстанавливает его заново.
 */
import type { MediaId } from "../types";

export type UploadPhase =
  | "preparing" // файл принят, идёт подготовка (сохранение метаданных, постановка в очередь)
  | "queued" // ждёт своей очереди (впереди другой файл)
  | "uploading" // идёт передача байтов
  | "retrying" // связь прервалась, повторная попытка
  | "waiting-net" // нет интернета — продолжится само
  | "waiting-auth" // нужно снова войти в Google Диск
  | "waiting-account" // нужно войти в аккаунт, файл сохранён на телефоне
  | "done"
  | "error";

export type UploadState = {
  id: MediaId;
  name?: string;
  phase: UploadPhase;
  /** Реально переданные байты. */
  loaded: number;
  total: number;
  /** Процент неизвестен (загрузка без отчёта о прогрессе). */
  indeterminate?: boolean;
  message?: string;
  /** Копия файла на телефоне (IndexedDB) готова — видео переживёт перезапуск приложения. */
  savedLocally?: boolean;
  /** Сохранить копию на телефоне не удалось (например, нет места) — нельзя закрывать приложение. */
  localFailed?: boolean;
};

const states = new Map<MediaId, UploadState>();
const listeners = new Set<() => void>();
const doneTimers = new Map<MediaId, ReturnType<typeof setTimeout>>();
let version = 0;
let scheduled = false;

function emit() {
  version++;
  // Склеиваем частые события прогресса в одно обновление интерфейса на кадр.
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    listeners.forEach((fn) => fn());
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

export function getUpload(id: MediaId | undefined): UploadState | undefined {
  return id ? states.get(id) : undefined;
}

export function listUploads(): UploadState[] {
  return Array.from(states.values());
}

export function uploadsVersion() {
  return version;
}

export function onUploadChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setUpload(id: MediaId, patch: Partial<Omit<UploadState, "id">>) {
  const prev = states.get(id);
  const next: UploadState = { id, phase: "preparing", loaded: 0, total: 0, ...prev, ...patch };
  if (patch.phase && patch.phase !== "error" && patch.phase !== "waiting-auth" && !("message" in patch)) next.message = undefined;
  // Без лишних перерисовок: прогресс обновляем, только если сменился хотя бы на 0,1 %.
  if (
    prev &&
    prev.phase === next.phase &&
    prev.message === next.message &&
    prev.savedLocally === next.savedLocally &&
    prev.localFailed === next.localFailed &&
    prev.total === next.total &&
    Math.floor((prev.loaded / (prev.total || 1)) * 1000) === Math.floor((next.loaded / (next.total || 1)) * 1000)
  ) {
    states.set(id, next);
    return;
  }
  states.set(id, next);
  const t = doneTimers.get(id);
  if (t) clearTimeout(t);
  doneTimers.delete(id);
  if (next.phase === "done") {
    // «Загружено ✓» видно несколько секунд, затем плашка исчезает.
    doneTimers.set(
      id,
      setTimeout(() => {
        if (states.get(id)?.phase === "done") {
          states.delete(id);
          emit();
        }
      }, 5000)
    );
  }
  updateUnloadGuard();
  emit();
}

export function clearUpload(id: MediaId) {
  if (states.delete(id)) emit();
}

const ACTIVE: UploadPhase[] = ["preparing", "queued", "uploading", "retrying", "waiting-net"];
export const isActive = (s?: UploadState) => !!s && ACTIVE.includes(s.phase);

/**
 * Пока видео существует только в памяти вкладки (копия на телефоне ещё не готова
 * или не удалась), просим браузер предупредить при закрытии страницы.
 */
let guardOn = false;
function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = "";
}
function updateUnloadGuard() {
  if (typeof window === "undefined") return;
  const risky = listUploads().some((s) => isActive(s) && !s.savedLocally);
  if (risky && !guardOn) window.addEventListener("beforeunload", onBeforeUnload);
  if (!risky && guardOn) window.removeEventListener("beforeunload", onBeforeUnload);
  guardOn = risky;
}

/** «84 МБ» / «1,2 ГБ». */
export function fmtSize(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} ГБ`;
  if (n >= 10 * 1024 ** 2) return `${Math.round(n / 1024 ** 2)} МБ`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

export function percentOf(s: UploadState): number {
  if (!s.total) return 0;
  return Math.min(100, Math.floor((s.loaded / s.total) * 100));
}

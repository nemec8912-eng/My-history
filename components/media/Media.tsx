"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { connectDrive } from "@/lib/media/gdrive";
import { addMedia, addMediaFiles, retryUpload } from "@/lib/media/store";
import { notePickerOpened } from "@/lib/media/timing";
import { fmtSize, percentOf } from "@/lib/media/uploadState";
import type { MediaItem, MediaKind } from "@/lib/types";
import { useMediaMetas, useMediaUrl, useUpload } from "./useMedia";

export function MediaImg({
  id,
  variant = "thumb",
  className,
  alt = "",
}: {
  id?: string;
  variant?: "thumb" | "original";
  className?: string;
  alt?: string;
}) {
  const url = useMediaUrl(id, variant);
  if (!url) return <span className={`imgPlaceholder ${className ?? ""}`} aria-hidden />;
  return <img src={url} alt={alt} className={className} loading="lazy" draggable={false} />;
}

export function fmtDur(sec?: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function VideoThumb({ id, duration }: { id: string; duration?: number }) {
  // Сначала кадр-обложка (лёгкий); сам ролик загружается только при открытии.
  const poster = useMediaUrl(id, "thumb");
  return (
    <span className="videoThumb">
      {poster ? <img src={poster} alt="" loading="lazy" /> : <span className="imgPlaceholder videoPh">🎬</span>}
      <span className="playBadge">▶</span>
      {duration ? <span className="durBadge">{fmtDur(duration)}</span> : null}
      <UploadBadge id={id} />
    </span>
  );
}

/** Маленькая метка на плитке видео: «27 %», «!» при ошибке, «✓» по завершении. */
function UploadBadge({ id }: { id: string }) {
  const s = useUpload(id);
  if (!s) return null;
  const bad = s.phase === "error" || s.phase === "waiting-auth";
  const text =
    s.phase === "done" ? "✓" : bad ? "!" : s.phase === "uploading" || s.phase === "retrying" ? (s.indeterminate ? "↑" : `${percentOf(s)}%`) : "…";
  return (
    <span className={`upBadge ${bad ? "bad" : s.phase === "done" ? "ok" : ""}`} aria-label="Состояние загрузки">
      {text}
      {!bad && s.phase !== "done" && !s.indeterminate && <i style={{ width: `${percentOf(s)}%` }} />}
    </span>
  );
}

/** Подробная строка состояния загрузки видео с реальным процентом и действиями. */
export function UploadStatus({ id }: { id: string }) {
  const s = useUpload(id);
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const pct = percentOf(s);
  const sizes = s.total ? `Загружено ${fmtSize(s.loaded)} из ${fmtSize(s.total)}` : "";
  let title: string;
  let detail: string | null = null;
  let bar: "progress" | "indeterminate" | "none" = "none";
  switch (s.phase) {
    case "preparing":
      title = "Подготовка видео…";
      bar = "indeterminate";
      break;
    case "queued":
      title = "Ожидает загрузки…";
      detail = s.total ? `Размер ${fmtSize(s.total)}` : null;
      bar = "indeterminate";
      break;
    case "uploading":
      if (s.indeterminate) {
        title = "Загрузка видео…";
        bar = "indeterminate";
      } else {
        title = `Загрузка видео — ${pct}%`;
        detail = sizes;
        bar = "progress";
      }
      break;
    case "retrying":
      title = "Связь прервалась. Повторная попытка…";
      detail = s.total ? `${sizes} — ${pct}%` : null;
      bar = "progress";
      break;
    case "waiting-net":
      title = "Нет интернета. Загрузка продолжится автоматически";
      detail = s.total ? `${sizes} — ${pct}%` : null;
      bar = "progress";
      break;
    case "waiting-auth":
      title = s.message ?? "Нужно снова подключить Google Диск";
      break;
    case "waiting-account":
      title = s.message ?? "Видео сохранено на телефоне";
      break;
    case "done":
      title = s.message ?? "Видео загружено";
      break;
    default:
      title = s.message ?? "Не удалось загрузить видео";
  }
  const isError = s.phase === "error";
  return (
    <div className={`uploadStatus ${isError || s.phase === "waiting-auth" ? "bad" : s.phase === "done" ? "ok" : ""}`} role="status" aria-live="polite">
      <div className="usText">
        <strong>{s.phase === "done" ? "✓ " : ""}{title}</strong>
        {detail && <span>{detail}</span>}
        {s.localFailed && s.phase !== "done" && <span className="usWarn">Не закрывайте приложение до окончания загрузки</span>}
      </div>
      {bar !== "none" && (
        <div className={`usBar ${bar === "indeterminate" ? "ind" : ""}`}>
          <i style={bar === "progress" ? { width: `${pct}%` } : undefined} />
        </div>
      )}
      {(isError || s.phase === "waiting-auth") && (
        <button
          type="button"
          className="usBtn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (s.phase === "waiting-auth") await connectDrive();
              await retryUpload(id);
            } catch {
              /* окно входа закрыто — кнопка останется */
            } finally {
              setBusy(false);
            }
          }}
        >
          {s.phase === "waiting-auth" ? "Подключить" : "Повторить"}
        </button>
      )}
    </div>
  );
}

/** Список состояний загрузки для набора файлов (показывает только видео в процессе). */
export function UploadStatusList({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="uploadList">
      {ids.map((id) => (
        <UploadStatus key={id} id={id} />
      ))}
    </div>
  );
}

function AudioRow({ meta, onRemove }: { meta: MediaItem; onRemove?: (id: string) => void }) {
  const url = useMediaUrl(meta.id, "original");
  return (
    <div className="audioRow">
      <span className="audioIcon">🎙</span>
      <div className="audioBody">
        <span className="audioName">{meta.name && !meta.name.startsWith("voice") ? meta.name : "Голосовая заметка"}</span>
        {url ? <audio src={url} controls preload="metadata" /> : <span className="muted small">Загрузка…</span>}
      </div>
      {onRemove && (
        <button type="button" className="iconBtn" aria-label="Удалить" onClick={() => confirm("Убрать эту голосовую заметку из момента? Сам файл не удаляется.") && onRemove(meta.id)}>
          ×
        </button>
      )}
    </div>
  );
}

function Lightbox({
  items,
  start,
  onClose,
  onRemove,
  onSetCover,
}: {
  items: MediaItem[];
  start: number;
  onClose: () => void;
  onRemove?: (id: string) => void;
  onSetCover?: (id: string) => void;
}) {
  const [i, setI] = useState(start);
  const item = items[i];
  const url = useMediaUrl(item?.id, "original");
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(items.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, onClose]);

  if (!item) return null;
  return (
    <div
      className="lightbox"
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx < -50) setI((v) => Math.min(items.length - 1, v + 1));
        if (dx > 50) setI((v) => Math.max(0, v - 1));
        touchX.current = null;
      }}
    >
      <div className="lightboxTop" onClick={(e) => e.stopPropagation()}>
        <span>
          {i + 1} / {items.length}
        </span>
        <div className="lightboxActions">
          {onSetCover && item.kind === "image" && (
            <button type="button" onClick={() => onSetCover(item.id)}>
              Сделать обложкой
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("Убрать этот файл из момента? Сам файл на Google Диске не удаляется.")) return;
                onRemove(item.id);
                if (items.length <= 1) onClose();
                else setI((v) => Math.min(v, items.length - 2));
              }}
            >
              Удалить
            </button>
          )}
          <button type="button" className="lightboxClose" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="lightboxStage" onClick={(e) => e.stopPropagation()}>
        {!url ? (
          <span className="muted">Загрузка…</span>
        ) : item.kind === "video" ? (
          <video src={url} controls playsInline autoPlay />
        ) : (
          <img src={url} alt="" />
        )}
      </div>
      {i > 0 && (
        <button type="button" className="lightboxNav prev" onClick={(e) => (e.stopPropagation(), setI(i - 1))} aria-label="Назад">
          ‹
        </button>
      )}
      {i < items.length - 1 && (
        <button type="button" className="lightboxNav next" onClick={(e) => (e.stopPropagation(), setI(i + 1))} aria-label="Вперёд">
          ›
        </button>
      )}
    </div>
  );
}

/** Галерея медиа: фото и видео сеткой, голосовые — списком. */
export function MediaGallery({
  ids,
  kinds = ["image", "video", "audio"],
  limit,
  onRemove,
  onSetCover,
  empty,
}: {
  ids: string[];
  kinds?: MediaKind[];
  limit?: number;
  onRemove?: (id: string) => void;
  onSetCover?: (id: string) => void;
  empty?: string;
}) {
  const metas = useMediaMetas(ids).filter((m) => kinds.includes(m.kind));
  const [open, setOpen] = useState<number | null>(null);
  const visual = metas.filter((m) => m.kind !== "audio");
  const audio = metas.filter((m) => m.kind === "audio");
  const shown = limit ? visual.slice(0, limit) : visual;
  const rest = visual.length - shown.length;

  if (!metas.length) return empty ? <p className="muted small emptyNote">{empty}</p> : null;

  return (
    <div className="mediaGallery">
      {visual.length > 0 && (
        <div className="mediaGrid">
          {shown.map((m, idx) => (
            <button type="button" key={m.id} className="mediaCell" onClick={() => setOpen(idx)}>
              {m.kind === "video" ? <VideoThumb id={m.id} duration={m.duration} /> : <MediaImg id={m.id} />}
              {rest > 0 && idx === shown.length - 1 && <span className="moreBadge">+{rest}</span>}
            </button>
          ))}
        </div>
      )}
      {audio.map((m) => (
        <AudioRow key={m.id} meta={m} onRemove={onRemove} />
      ))}
      {open != null && (
        <Lightbox items={visual} start={open} onClose={() => setOpen(null)} onRemove={onRemove} onSetCover={onSetCover} />
      )}
    </div>
  );
}

function VoiceRecorder({ onAdd, onBusy }: { onAdd: (items: MediaItem[]) => void; onBusy: (b: boolean) => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec]);

  if (typeof window !== "undefined" && typeof window.MediaRecorder === "undefined") return null;

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = r.mimeType || "audio/mp4";
        const ext = type.includes("webm") ? "webm" : type.includes("ogg") ? "ogg" : "m4a";
        const file = new File(chunks.current, `voice-${Date.now()}.${ext}`, { type });
        onBusy(true);
        try {
          onAdd([await addMedia(file)]);
        } finally {
          onBusy(false);
        }
      };
      r.start();
      setSeconds(0);
      setRec(r);
    } catch {
      alert("Нет доступа к микрофону");
    }
  }

  function stop() {
    rec?.stop();
    setRec(null);
  }

  return rec ? (
    <button type="button" className="pickBtn recording" onClick={stop}>
      ■ Стоп {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </button>
  ) : (
    <button type="button" className="pickBtn" onClick={start}>
      🎙 Записать
    </button>
  );
}

/** Кнопки добавления медиа. На iPhone input file работает через label. */
export function MediaPicker({
  onAdd,
  kinds = ["image", "video", "audio"],
  compact,
}: {
  onAdd: (items: MediaItem[]) => void;
  kinds?: MediaKind[];
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [videoIds, setVideoIds] = useState<string[]>([]);

  async function handle(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const items = await addMediaFiles(files);
      const vids = items.filter((i) => i.kind === "video").map((i) => i.id);
      if (vids.length) setVideoIds((v) => [...v, ...vids]);
      onAdd(items);
    } catch (err) {
      alert("Не удалось сохранить файл: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`mediaPicker ${compact ? "compact" : ""}`}>
      {kinds.includes("image") && (
        <label className="pickBtn">
          + Фото
          <input type="file" accept="image/*" multiple onChange={handle} />
        </label>
      )}
      {kinds.includes("video") && (
        <label className="pickBtn">
          + Видео
          <input type="file" accept="video/*" multiple onChange={handle} onClick={notePickerOpened} />
        </label>
      )}
      {kinds.includes("audio") && (
        <>
          <label className="pickBtn">
            + Аудио
            <input type="file" accept="audio/*" multiple onChange={handle} />
          </label>
          <VoiceRecorder onAdd={onAdd} onBusy={setBusy} />
        </>
      )}
      {busy && <span className="muted small">Сохраняю…</span>}
      <UploadStatusList ids={videoIds} />
    </div>
  );
}

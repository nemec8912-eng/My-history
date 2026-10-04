"use client";

import { useEffect, useRef, useState } from "react";
import type { Checkpoint } from "@/lib/types";
import { CheckpointEditor, withAddedMedia, withRemovedMedia } from "../CheckpointEditor";
import { MediaCounts } from "../media/MediaCounts";
import { TRAVEL } from "@/lib/travel";

const IMPORTANCE = ["Обычная", "Заметная", "Важная", "Главная"];
import { MediaGallery, MediaImg, MediaPicker } from "../media/Media";
import { Sheet } from "../Sheet";

/** Карточка контрольной точки: просмотр и редактирование. */
export function StoryPointModal({
  cp,
  index,
  total,
  startInEdit,
  onClose,
  onSave,
  onDelete,
  onMove,
  onSetStart,
  onSetEnd,
  onOpenPlace,
  onNavigate,
  defaultDate,
}: {
  defaultDate?: string;
  cp: Checkpoint;
  index: number;
  total: number;
  startInEdit?: boolean;
  onClose: () => void;
  onSave: (cp: Checkpoint) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onSetStart: (id: string) => void;
  onSetEnd: (id: string) => void;
  onOpenPlace: (id: string) => void;
  onNavigate: (index: number) => void;
}) {
  const [edit, setEdit] = useState(Boolean(startInEdit));
  const touchX = useRef<number | null>(null);
  // При переходе к другой точке выходим из редактирования.
  useEffect(() => {
    setEdit(Boolean(startInEdit));
  }, [cp.id, startInEdit]);
  const regular = cp.kind === "regular";

  return (
    <Sheet onClose={onClose}>
      {edit ? (
        <CheckpointEditor
          value={cp}
          defaultDate={defaultDate}
          onCancel={() => (startInEdit ? onClose() : setEdit(false))}
          onSave={(next) => {
            onSave(next);
            setEdit(false);
          }}
          onDelete={regular ? () => confirm("Удалить эту точку? Фото и видео останутся на Google Диске.") && onDelete(cp.id) : undefined}
          onMove={regular ? (dir) => onMove(cp.id, dir) : undefined}
          canMoveUp={regular && index > 1}
          canMoveDown={regular && index < total - 2}
        />
      ) : (
        <div className="pointView">
          <div
            className={`pointHero premiumHero ${cp.coverMediaId ? "hasPhoto" : ""}`}
            style={{ ["--accent" as string]: cp.style.color }}
            onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchX.current == null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              touchX.current = null;
              if (dx < -60 && index < total - 1) onNavigate(index + 1);
              if (dx > 60 && index > 0) onNavigate(index - 1);
            }}
          >
            {cp.coverMediaId ? <MediaImg id={cp.coverMediaId} variant="original" /> : <span className="pointHeroEmpty">{cp.icon ?? "📍"}</span>}
            <div className="heroShade" />
            <div className="heroText">
              <span className="heroBadge">
                Точка {index + 1} из {total}
                {cp.kind === "start" ? " · начало" : cp.kind === "end" ? " · финиш" : ""}
              </span>
              <h3>{cp.title}</h3>
            </div>
          </div>

          <div className="pointChips">
            {cp.time && <span className="pchip">🕒 {cp.time}</span>}
            {cp.arrivedBy && (
              <span className="pchip">
                {TRAVEL[cp.arrivedBy].icon} {TRAVEL[cp.arrivedBy].label}
              </span>
            )}
            {cp.importance > 0 && <span className="pchip accent">★ {IMPORTANCE[cp.importance] ?? "Важная"}</span>}
            {cp.location?.label && <span className="pchip">📍 {cp.location.label}</span>}
            <MediaCounts ids={cp.mediaIds} className="pchip" />
          </div>

          {cp.description && <blockquote className="pointQuote">{cp.description}</blockquote>}

          <div className="pointSection">
            <div className="pointSectionHead">
              <span>Фото, видео и голос</span>
            </div>
            <MediaPicker compact onAdd={(items) => onSave(withAddedMedia(cp, items))} />
            <MediaGallery
              ids={cp.mediaIds}
              onRemove={(mid) => onSave(withRemovedMedia(cp, mid))}
              onSetCover={(mid) => onSave({ ...cp, coverMediaId: mid })}
              empty="Добавьте сюда фотографии, видео или запишите голосовую заметку."
            />
          </div>

          <div className="pointNav">
            <button type="button" className="navBtn" disabled={index === 0} onClick={() => onNavigate(index - 1)}>
              ‹ Раньше
            </button>
            <span className="navDots" aria-hidden>
              {Array.from({ length: Math.min(total, 12) }, (_, i) => (
                <i key={i} className={i === Math.min(index, 11) ? "on" : ""} />
              ))}
            </span>
            <button type="button" className="navBtn" disabled={index >= total - 1} onClick={() => onNavigate(index + 1)}>
              Дальше ›
            </button>
          </div>

          <div className="editorActions">
            {cp.kind !== "start" && (
              <button type="button" className="softBtn" onClick={() => onSetStart(cp.id)}>
                Сделать стартом
              </button>
            )}
            {cp.kind !== "end" && (
              <button type="button" className="softBtn" onClick={() => onSetEnd(cp.id)}>
                Сделать финишем
              </button>
            )}
            {cp.place && (
              <button type="button" className="softBtn" onClick={() => onOpenPlace(cp.id)}>
                Открыть локацию ›
              </button>
            )}
            <button type="button" className="primary" onClick={() => setEdit(true)}>
              Изменить
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

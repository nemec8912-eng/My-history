"use client";

import { useState } from "react";
import type { Checkpoint } from "@/lib/types";
import { CheckpointEditor } from "../CheckpointEditor";
import { MediaGallery, MediaImg } from "../media/Media";
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
  onOpenPlace,
}: {
  cp: Checkpoint;
  index: number;
  total: number;
  startInEdit?: boolean;
  onClose: () => void;
  onSave: (cp: Checkpoint) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onOpenPlace: (id: string) => void;
}) {
  const [edit, setEdit] = useState(Boolean(startInEdit));
  const regular = cp.kind === "regular";

  return (
    <Sheet onClose={onClose}>
      {edit ? (
        <CheckpointEditor
          value={cp}
          onCancel={() => (startInEdit ? onClose() : setEdit(false))}
          onSave={(next) => {
            onSave(next);
            setEdit(false);
          }}
          onDelete={regular ? () => onDelete(cp.id) : undefined}
          onMove={regular ? (dir) => onMove(cp.id, dir) : undefined}
          canMoveUp={regular && index > 1}
          canMoveDown={regular && index < total - 2}
        />
      ) : (
        <div className="pointView">
          <div className="pointHero" style={{ ["--accent" as string]: cp.style.color }}>
            {cp.coverMediaId ? <MediaImg id={cp.coverMediaId} variant="original" /> : <span className="pointHeroEmpty">{cp.icon ?? "📍"}</span>}
          </div>
          <p className="eyebrow" style={{ color: cp.style.color }}>
            Точка {index + 1} из {total}
            {cp.kind === "start" ? " · начало" : cp.kind === "end" ? " · финиш" : ""}
          </p>
          <h3>{cp.title}</h3>
          <div className="metaList">
            {cp.time && <span>🕒 {cp.time}</span>}
            {cp.location && (cp.location.label || cp.location.lat) ? (
              <span>
                📍 {cp.location.label ?? ""}
                {cp.location.lat ? ` (${cp.location.lat.toFixed(5)}, ${cp.location.lon.toFixed(5)})` : ""}
              </span>
            ) : null}
          </div>
          {cp.description && <p className="pointText">{cp.description}</p>}
          <MediaGallery ids={cp.mediaIds} empty="Фото, видео и голосовые заметки можно добавить в редактировании." />
          <div className="editorActions">
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

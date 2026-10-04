"use client";

import { useState } from "react";
import { PALETTE, SHAPES, SHAPE_IDS, SIZES, SIZE_IDS, safeColor } from "@/lib/markerStyle";
import type { Checkpoint, MediaItem } from "@/lib/types";
import { MediaGallery, MediaPicker } from "./media/Media";
import { PointMarker } from "./PointMarker";
import { PlacePicker } from "./PlacePicker";
import { TRAVEL, TRAVEL_IDS } from "@/lib/travel";

const ICONS = ["", "🏠", "🚉", "🚆", "🚇", "🚌", "🚕", "🚗", "🚶", "🔁", "☕", "🍽", "📷", "🌳", "🎡", "🐘", "🏛", "⭐", "❤️", "🎉"];
const IMPORTANCE = ["Обычная", "Заметная", "Важная", "Главная"];

export function withAddedMedia<T extends { mediaIds: string[]; coverMediaId?: string }>(item: T, added: MediaItem[]): T {
  const ids = [...item.mediaIds, ...added.map((m) => m.id)];
  const firstImage = added.find((m) => m.kind === "image");
  return { ...item, mediaIds: ids, coverMediaId: item.coverMediaId ?? firstImage?.id };
}

export function withRemovedMedia<T extends { mediaIds: string[]; coverMediaId?: string }>(item: T, id: string): T {
  const ids = item.mediaIds.filter((m) => m !== id);
  return { ...item, mediaIds: ids, coverMediaId: item.coverMediaId === id ? undefined : item.coverMediaId };
}

export function CheckpointEditor({
  value,
  onSave,
  onCancel,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  value: Checkpoint;
  onSave: (cp: Checkpoint) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [cp, setCp] = useState<Checkpoint>(value);
  const set = (patch: Partial<Checkpoint>) => setCp((c) => ({ ...c, ...patch }));
  const setStyle = (patch: Partial<Checkpoint["style"]>) => setCp((c) => ({ ...c, style: { ...c.style, ...patch } }));

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...cp, title: cp.title.trim() || "Без названия" });
      }}
    >
      <div className="editorPreview">
        <PointMarker style={cp.style} d={SIZES[cp.style.size].px + 8} photoId={cp.style.showPhoto ? cp.coverMediaId : undefined} label={cp.icon || "•"} />
        <div>
          <p className="eyebrow">{cp.kind === "start" ? "Начало пути" : cp.kind === "end" ? "Конечная точка" : "Контрольная точка"}</p>
          <strong>{cp.title || "Без названия"}</strong>
        </div>
      </div>

      {cp.kind !== "start" && (
        <fieldset>
          <legend>Как добрались сюда</legend>
          <div className="chips">
            {TRAVEL_IDS.map((m) => (
              <button
                type="button"
                key={m}
                className={`chip travelChip ${cp.arrivedBy === m ? "on" : ""}`}
                onClick={() => set({ arrivedBy: cp.arrivedBy === m ? undefined : m })}
              >
                <span aria-hidden>{TRAVEL[m].icon}</span> {TRAVEL[m].label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label>
        Название
        <input value={cp.title} onChange={(e) => set({ title: e.target.value })} placeholder="Например, станция Лобня" />
      </label>

      <div className="row">
        <label>
          Время
          <input type="time" value={cp.time ?? ""} onChange={(e) => set({ time: e.target.value || undefined })} />
        </label>
        <label>
          Значок
          <select value={cp.icon ?? ""} onChange={(e) => set({ icon: e.target.value || undefined })}>
            {ICONS.map((i) => (
              <option key={i} value={i}>
                {i || "Номер точки"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Описание
        <textarea rows={3} value={cp.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} placeholder="Что здесь было?" />
      </label>

      <div className="fieldBlock">
        <span className="fieldLabel">Место</span>
        <PlacePicker value={cp.location} onChange={(loc) => set({ location: loc })} />
      </div>

      <div className="row">
        <label>
          Дата
          <input type="date" value={cp.meta?.date ?? ""} onChange={(e) => set({ meta: { ...cp.meta, date: e.target.value || undefined, weather: undefined } })} />
        </label>
        <span />
      </div>


      <fieldset>
        <legend>Форма</legend>
        <div className="chips">
          {SHAPE_IDS.map((s) => (
            <button type="button" key={s} className={`chip shapeChip ${cp.style.shape === s ? "on" : ""}`} onClick={() => setStyle({ shape: s })} aria-label={SHAPES[s].label} title={SHAPES[s].label}>
              <PointMarker style={{ ...cp.style, shape: s }} d={30} label="" />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Цвет</legend>
        <div className="chips">
          {PALETTE.map((c) => (
            <button type="button" key={c} className={`swatch ${cp.style.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setStyle({ color: c })} aria-label={c} />
          ))}
          <label className="swatch custom" title="Свой цвет">
            <input type="color" value={safeColor(cp.style.color)} onChange={(e) => setStyle({ color: e.target.value })} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Размер</legend>
        <div className="chips">
          {SIZE_IDS.map((s) => (
            <button type="button" key={s} className={`chip ${cp.style.size === s ? "on" : ""}`} onClick={() => setStyle({ size: s })}>
              {SIZES[s].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Важность</legend>
        <div className="chips">
          {IMPORTANCE.map((label, i) => (
            <button type="button" key={label} className={`chip ${cp.importance === i ? "on" : ""}`} onClick={() => set({ importance: i })}>
              {label}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={cp.style.showPhoto} onChange={(e) => setStyle({ showPhoto: e.target.checked })} />
          Показывать фото внутри значка
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={Boolean(cp.place)}
            onChange={(e) => set({ place: e.target.checked ? cp.place ?? { moments: [] } : undefined })}
          />
          Большая локация (своя страница с галереей и моментами)
        </label>
      </fieldset>

      {cp.place && (
        <div className="row">
          <label>
            Пришли
            <input type="time" value={cp.place.arrivedAt ?? cp.time ?? ""} onChange={(e) => set({ place: { ...cp.place!, arrivedAt: e.target.value || undefined } })} />
          </label>
          <label>
            Ушли
            <input type="time" value={cp.place.leftAt ?? ""} onChange={(e) => set({ place: { ...cp.place!, leftAt: e.target.value || undefined } })} />
          </label>
        </div>
      )}

      <fieldset>
        <legend>Фото, видео, голос</legend>
        <MediaPicker onAdd={(items) => setCp((c) => withAddedMedia(c, items))} />
        <MediaGallery
          ids={cp.mediaIds}
          onRemove={(id) => setCp((c) => withRemovedMedia(c, id))}
          onSetCover={(id) => set({ coverMediaId: id })}
          empty="Пока ничего не добавлено. Первое фото станет превью точки."
        />
      </fieldset>

      {onMove && (canMoveUp || canMoveDown) && (
        <div className="row">
          <button type="button" className="softBtn" disabled={!canMoveUp} onClick={() => onMove(-1)}>
            ↑ Раньше
          </button>
          <button type="button" className="softBtn" disabled={!canMoveDown} onClick={() => onMove(1)}>
            ↓ Позже
          </button>
        </div>
      )}

      <div className="editorActions">
        {onDelete && (
          <button type="button" className="dangerBtn" onClick={() => confirm("Удалить точку?") && onDelete()}>
            Удалить
          </button>
        )}
        <button type="button" className="softBtn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="primary">
          Сохранить
        </button>
      </div>
    </form>
  );
}

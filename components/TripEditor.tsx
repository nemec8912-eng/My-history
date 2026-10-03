"use client";

import { useState } from "react";
import type { Trip } from "@/lib/types";
import { withAddedMedia } from "./CheckpointEditor";
import { MediaImg, MediaPicker } from "./media/Media";

/** Редактирование основных данных поездки: название, дата, обложка, описание. */
export function TripEditor({
  value,
  onSave,
  onCancel,
  onDelete,
}: {
  value: Trip;
  onSave: (t: Trip) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [t, setT] = useState(value);
  const set = (patch: Partial<Trip>) => setT((x) => ({ ...x, ...patch }));
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...t, title: t.title.trim() || "Без названия" });
      }}
    >
      <p className="eyebrow">Поездка</p>
      <h3>Изменить поездку</h3>
      <label>
        Название
        <input required value={t.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Дата
          <input type="date" value={t.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label>
          Время
          <input type="time" value={t.time ?? ""} onChange={(e) => set({ time: e.target.value || undefined })} />
        </label>
      </div>
      <label>
        Место
        <input value={t.place ?? ""} onChange={(e) => set({ place: e.target.value || undefined })} placeholder="Москва" />
      </label>
      <label>
        Описание
        <textarea rows={3} value={t.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
      </label>
      <fieldset>
        <legend>Обложка</legend>
        {t.coverMediaId && <MediaImg id={t.coverMediaId} variant="original" className="coverPreview" />}
        <MediaPicker
          kinds={["image"]}
          onAdd={(items) => setT((x) => ({ ...withAddedMedia(x, items), coverMediaId: items[0]?.id ?? x.coverMediaId }))}
        />
      </fieldset>
      <div className="editorActions">
        {onDelete && (
          <button type="button" className="dangerBtn" onClick={() => confirm("Удалить поездку целиком?") && onDelete()}>
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

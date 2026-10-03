"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CheckpointEditor, withAddedMedia, withRemovedMedia } from "@/components/CheckpointEditor";
import { MediaGallery, MediaImg, MediaPicker } from "@/components/media/Media";
import { Sheet } from "@/components/Sheet";
import { formatDate, formatDuration, minutesOf } from "@/lib/format";
import { newId } from "@/lib/markerStyle";
import { useTrip } from "@/lib/useTrip";
import type { Checkpoint, MediaKind, Moment } from "@/lib/types";

type Tab = "image" | "video" | "audio" | "moments";

export default function PlacePage() {
  const { id, cpId } = useParams<{ id: string; cpId: string }>();
  const { trip, status, update, saving } = useTrip(id);
  const [tab, setTab] = useState<Tab>("image");
  const [edit, setEdit] = useState(false);
  const [moment, setMoment] = useState<Moment | null>(null);

  if (status === "loading") return <main className="shell"><p className="muted">Загрузка…</p></main>;
  const cp = trip?.checkpoints.find((c) => c.id === cpId);
  if (!trip || !cp)
    return (
      <main className="shell">
        <Link className="backLink" href={`/trip/${id}`}>← Назад</Link>
        <p className="muted" style={{ marginTop: 20 }}>Локация не найдена.</p>
      </main>
    );

  const place = cp.place ?? { moments: [] };
  const save = (next: Checkpoint) =>
    update({ ...trip, checkpoints: trip.checkpoints.map((c) => (c.id === next.id ? next : c)) });
  const arrived = place.arrivedAt ?? cp.time;
  const a = minutesOf(arrived);
  const b = minutesOf(place.leftAt);
  const stay = a != null && b != null && b > a ? formatDuration(b - a) : null;

  const saveMoment = (m: Moment) => {
    const exists = place.moments.some((x) => x.id === m.id);
    const moments = exists ? place.moments.map((x) => (x.id === m.id ? m : x)) : [...place.moments, m];
    moments.sort((x, y) => (x.time ?? "99").localeCompare(y.time ?? "99"));
    save({ ...cp, place: { ...place, moments } });
    setMoment(null);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "image", label: "Фото" },
    { id: "video", label: "Видео" },
    { id: "audio", label: "Аудио" },
    { id: "moments", label: `Моменты (${place.moments.length})` },
  ];

  return (
    <main className="placePage">
      <div className="placeHero" style={{ ["--accent" as string]: cp.style.color }}>
        {cp.coverMediaId ? <MediaImg id={cp.coverMediaId} variant="original" /> : <span className="placeHeroEmpty">★</span>}
        <Link className="roundBtn floating" href={`/trip/${trip.id}`} aria-label="Назад">←</Link>
      </div>

      <div className="placeBody">
        <div className="placeHead">
          <div>
            <h1>{cp.title}</h1>
            <p className="placeSub" style={{ color: cp.style.color }}>Основная локация · {trip.title}</p>
          </div>
          <button className="primary" onClick={() => setEdit(true)}>Изменить</button>
        </div>

        <div className="metaList">
          <span>📅 {formatDate(trip.date)}</span>
          {(arrived || place.leftAt) && (
            <span>
              🕒 {[arrived, place.leftAt].filter(Boolean).join(" – ")}
              {stay ? ` (${stay})` : ""}
            </span>
          )}
          {cp.location?.label && <span>📍 {cp.location.label}</span>}
          {saving && <span className="muted">сохраняю…</span>}
        </div>
        {cp.description && <p className="pointText">{cp.description}</p>}

        <div className="tabs">
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "moments" ? (
          <div className="moments">
            {place.moments.map((m) => (
              <button key={m.id} className="momentCard" onClick={() => setMoment(m)}>
                {m.mediaIds[0] && <MediaImg id={m.mediaIds[0]} className="momentThumb" />}
                <span className="momentText">
                  <strong>{m.title}</strong>
                  {m.time && <span className="muted small">{m.time}</span>}
                  {m.description && <span className="muted small clamp2">{m.description}</span>}
                </span>
              </button>
            ))}
            <button className="addPointBtn" onClick={() => setMoment({ id: newId(), title: "", mediaIds: [] })}>
              + Добавить момент
            </button>
          </div>
        ) : (
          <>
            <MediaPicker kinds={[tab as MediaKind]} onAdd={(items) => save(withAddedMedia(cp, items))} />
            <MediaGallery
              ids={cp.mediaIds}
              kinds={[tab as MediaKind]}
              onRemove={(mid) => save(withRemovedMedia(cp, mid))}
              onSetCover={(mid) => save({ ...cp, coverMediaId: mid })}
              empty={tab === "image" ? "Добавьте фотографии этого места — можно сразу много." : "Пока пусто."}
            />
          </>
        )}
      </div>

      {edit && (
        <Sheet onClose={() => setEdit(false)}>
          <CheckpointEditor
            value={cp}
            onCancel={() => setEdit(false)}
            onSave={(next) => {
              save(next);
              setEdit(false);
            }}
          />
        </Sheet>
      )}

      {moment && (
        <Sheet onClose={() => setMoment(null)}>
          <MomentEditor
            value={moment}
            onSave={saveMoment}
            onCancel={() => setMoment(null)}
            onDelete={
              place.moments.some((x) => x.id === moment.id)
                ? () => {
                    save({ ...cp, place: { ...place, moments: place.moments.filter((x) => x.id !== moment.id) } });
                    setMoment(null);
                  }
                : undefined
            }
          />
        </Sheet>
      )}
    </main>
  );
}

function MomentEditor({
  value,
  onSave,
  onCancel,
  onDelete,
}: {
  value: Moment;
  onSave: (m: Moment) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [m, setM] = useState(value);
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...m, title: m.title.trim() || "Момент" });
      }}
    >
      <p className="eyebrow">Мини-событие</p>
      <label>
        Что произошло
        <input required value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder="Покормили жирафа" />
      </label>
      <label>
        Время
        <input type="time" value={m.time ?? ""} onChange={(e) => setM({ ...m, time: e.target.value || undefined })} />
      </label>
      <label>
        Описание
        <textarea rows={3} value={m.description ?? ""} onChange={(e) => setM({ ...m, description: e.target.value || undefined })} />
      </label>
      <MediaPicker onAdd={(items) => setM((x) => ({ ...x, mediaIds: [...x.mediaIds, ...items.map((i) => i.id)] }))} />
      <MediaGallery ids={m.mediaIds} onRemove={(id) => setM((x) => ({ ...x, mediaIds: x.mediaIds.filter((i) => i !== id) }))} />
      <div className="editorActions">
        {onDelete && (
          <button type="button" className="dangerBtn" onClick={() => confirm("Удалить момент?") && onDelete()}>
            Удалить
          </button>
        )}
        <button type="button" className="softBtn" onClick={onCancel}>Отмена</button>
        <button type="submit" className="primary">Сохранить</button>
      </div>
    </form>
  );
}

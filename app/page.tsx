"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { MediaImg, MediaPicker } from "@/components/media/Media";
import { Sheet } from "@/components/Sheet";
import { formatDate, plural } from "@/lib/format";
import { createCheckpoint } from "@/lib/markerStyle";
import { getRepo, newTrip } from "@/lib/repo";
import type { Checkpoint, Trip } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

function demoTrip(): Trip {
  const p = (title: string, time: string, icon: string, color: string, extra: Partial<Checkpoint> = {}) =>
    createCheckpoint("regular", { title, time, icon, style: { shape: "circle", color, size: "m", showLabel: false, showPhoto: true }, ...extra });
  return newTrip({
    title: "Поездка в зоопарк (пример)",
    date: today(),
    place: "Москва",
    description: "Пример поездки: откройте любую точку, добавьте фото, поменяйте форму, цвет и размер.",
    checkpoints: [
      createCheckpoint("start", { title: "Дом", time: "08:00", icon: "🏠", description: "Выезд из дома", location: { lat: 56.0123, lon: 37.4745, label: "Лобня" } }),
      p("Станция", "08:20", "🚉", "#2f6bff", { description: "Станция Лобня", location: { lat: 56.0136, lon: 37.4824 } }),
      p("Электричка", "08:40", "🚆", "#2f6bff", { description: "До Савёловского вокзала", style: { shape: "square", color: "#2f6bff", size: "m", showLabel: false, showPhoto: true } }),
      p("Метро", "09:15", "🚇", "#ef3b4a", { description: "Савёловская", importance: 1, location: { lat: 55.7939, lon: 37.5871 } }),
      p("Пересадка", "09:30", "🔁", "#8b3dff", { style: { shape: "diamond", color: "#8b3dff", size: "s", showLabel: false, showPhoto: true } }),
      p("Кафе", "10:10", "☕", "#ff8a1f", { description: "Завтрак в кафе", importance: 2, style: { shape: "circle", color: "#ff8a1f", size: "l", showLabel: false, showPhoto: true } }),
      p("Парк", "10:45", "🌳", "#16a36a", { description: "Прогулка по парку", style: { shape: "triangle", color: "#16a36a", size: "m", showLabel: false, showPhoto: true } }),
      createCheckpoint("end", {
        title: "Московский зоопарк",
        time: "11:20",
        icon: "🐘",
        description: "Основная локация поездки",
        location: { lat: 55.7612, lon: 37.5784, label: "Большая Грузинская ул., 1" },
        place: { arrivedAt: "11:20", leftAt: "16:30", moments: [] },
      }),
    ],
  });
}

export default function Home() {
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", date: today(), time: "", place: "", text: "", from: "", to: "", cover: undefined as string | undefined });

  useEffect(() => {
    getRepo()
      .then((r) => r.list())
      .then(setTrips)
      .catch(() => setTrips([]));
  }, []);

  const totals = useMemo(() => {
    const list = trips ?? [];
    return {
      trips: list.length,
      media: list.reduce((s, t) => s + t.mediaIds.length + t.checkpoints.reduce((a, c) => a + c.mediaIds.length, 0), 0),
    };
  }, [trips]);

  async function create(trip: Trip) {
    setBusy(true);
    try {
      await (await getRepo()).save(trip);
      router.push(`/trip/${trip.id}`);
    } catch (e) {
      alert("Не удалось сохранить: " + (e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const start = createCheckpoint("start", { title: draft.from.trim() || "Начало пути", time: draft.time || undefined });
    const end = createCheckpoint("end", { title: draft.to.trim() || draft.title.trim() });
    void create(
      newTrip({
        title: draft.title.trim(),
        date: draft.date,
        time: draft.time || undefined,
        place: draft.place.trim() || undefined,
        description: draft.text.trim() || undefined,
        coverMediaId: draft.cover,
        mediaIds: draft.cover ? [draft.cover] : [],
        checkpoints: [start, end],
      })
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Личный дневник</p>
          <h1>Моя история</h1>
        </div>
        <button className="avatar" aria-label="Профиль">Я</button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Твои воспоминания</p>
          <h2>Каждая поездка — отдельная история пути</h2>
          <p className="muted">Свой маршрут из контрольных точек, фото, видео и голосовые заметки — в одном событии.</p>
        </div>
        <div className="heroActions">
          <button className="primary" onClick={() => setOpen(true)}>+ Новая поездка</button>
        </div>
      </section>

      <section className="stats">
        <div><strong>{totals.trips}</strong><span>{plural(totals.trips, "поездка", "поездки", "поездок")}</span></div>
        <div><strong>{totals.media}</strong><span>{plural(totals.media, "файл", "файла", "файлов")}</span></div>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <h3>Мои поездки</h3>
        </div>

        {trips && trips.length === 0 && (
          <div className="emptyCard">
            <p>Здесь появятся ваши поездки.</p>
            <div className="heroActions">
              <button className="primary" onClick={() => setOpen(true)}>Создать поездку</button>
              <button className="softBtn" disabled={busy} onClick={() => create(demoTrip())}>Открыть пример</button>
            </div>
          </div>
        )}

        <div className="timeline">
          {trips?.map((t) => {
            const media = t.mediaIds.length + t.checkpoints.reduce((a, c) => a + c.mediaIds.length, 0);
            const cover = t.coverMediaId ?? t.checkpoints.find((c) => c.coverMediaId)?.coverMediaId;
            return (
              <Link className="card" key={t.id} href={`/trip/${t.id}`}>
                <div className="datePill">{formatDate(t.date)}{t.time ? ` · ${t.time}` : ""}</div>
                <div className="photoPlaceholder">
                  {cover ? <MediaImg id={cover} variant="original" className="coverImg" /> : "Обложка поездки"}
                  {media > 0 && <span className="photoCount">{media} {plural(media, "файл", "файла", "файлов")}</span>}
                </div>
                <div className="cardBody">
                  <p className="place">{t.place || "Место не указано"}</p>
                  <h4>{t.title}</h4>
                  <p className="muted">{t.description || `${t.checkpoints.length} ${plural(t.checkpoints.length, "точка", "точки", "точек")} маршрута`}</p>
                </div>
              </Link>
            );
          })}
        </div>
        {trips && trips.length > 0 && (
          <button className="softBtn" style={{ marginTop: 16 }} disabled={busy} onClick={() => create(demoTrip())}>
            + Пример поездки
          </button>
        )}
      </section>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <form className="editor" onSubmit={submit}>
            <p className="eyebrow">Новая история</p>
            <h3>Новая поездка</h3>
            <label>
              Название
              <input required placeholder="Например, Московский зоопарк" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <div className="row">
              <label>
                Дата
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label>
                Время выхода
                <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label>
                Откуда
                <input placeholder="Дом" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              </label>
              <label>
                Куда
                <input placeholder="Московский зоопарк" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </label>
            </div>
            <label>
              Город / место
              <input placeholder="Москва" value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} />
            </label>
            <label>
              Описание
              <textarea rows={3} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </label>
            <fieldset>
              <legend>Обложка</legend>
              {draft.cover && <MediaImg id={draft.cover} variant="original" className="coverPreview" />}
              <MediaPicker kinds={["image"]} onAdd={(items) => setDraft((d) => ({ ...d, cover: items.find((i) => i.kind === "image")?.id ?? d.cover }))} />
            </fieldset>
            <button className="primary wide" type="submit" disabled={busy}>Создать и открыть</button>
          </form>
        </Sheet>
      )}
    </main>
  );
}

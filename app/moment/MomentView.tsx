"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckpointEditor, withAddedMedia, withRemovedMedia } from "@/components/CheckpointEditor";
import { Icon } from "@/components/Icon";
import { MediaGallery, MediaImg, MediaPicker } from "@/components/media/Media";
import { useMediaMetas, useMediaUrl } from "@/components/media/useMedia";
import { Sheet } from "@/components/Sheet";
import { routes } from "@/lib/routes";
import { hasCoords, isEvent, momentDate } from "@/lib/stats";
import { useTrip } from "@/lib/useTrip";
import { fetchWeather } from "@/lib/weather";
import type { Checkpoint } from "@/lib/types";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap").then((m) => m.LeafletMap), { ssr: false });
const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function fullDate(d: string, time?: string) {
  const [y, m, day] = d.split("-").map(Number);
  if (!y) return d;
  return `${day} ${RU_MONTHS_GEN[m - 1]} ${y}${time ? `, ${time}` : ""}`;
}

function HeroMedia({ id, kind }: { id: string; kind: string }) {
  const url = useMediaUrl(id, kind === "video" ? "original" : "original");
  if (kind === "video") return url ? <video src={url} controls playsInline preload="metadata" /> : <span className="imgPlaceholder" />;
  return url ? <img src={url} alt="" /> : <span className="imgPlaceholder" />;
}

/** Просмотр момента (экран 4 макета). */
export function MomentView() {
  const params = useSearchParams();
  const tripId = params.get("trip") ?? undefined;
  const cpId = params.get("cp") ?? undefined;
  const router = useRouter();
  const { trip, status, update, remove } = useTrip(tripId);
  const [edit, setEdit] = useState(false);
  const [i, setI] = useState(0);
  const touchX = useRef<number | null>(null);
  const cp = trip?.checkpoints.find((c) => c.id === cpId);
  const metas = useMediaMetas(cp?.mediaIds ?? []);
  const visual = metas.filter((m) => m.kind !== "audio");
  const weatherTried = useRef("");

  useEffect(() => setI(0), [cpId]);

  // Погода: если её ещё нет, но есть место и дата — получаем и сохраняем в момент.
  // Ключ включает место, дату и время: после редактирования погода получается заново.
  useEffect(() => {
    if (!trip || !cp || cp.meta?.weather || !hasCoords(cp)) return;
    const key = `${cp.id}|${cp.location!.lat}|${cp.location!.lon}|${momentDate(trip, cp)}|${cp.time ?? ""}`;
    if (weatherTried.current === key) return;
    weatherTried.current = key;
    fetchWeather(cp.location!.lat, cp.location!.lon, momentDate(trip, cp), cp.time).then((w) => {
      if (w) update({ ...trip, checkpoints: trip.checkpoints.map((c) => (c.id === cp.id ? { ...c, meta: { ...c.meta, weather: w } } : c)) });
    });
  }, [trip, cp, update]);

  if (status === "loading") return <main className="shell"><p className="muted">Загрузка…</p></main>;
  if (!trip || !cp)
    return (
      <main className="shell">
        <Link className="backLink" href="/">← Назад</Link>
        <p className="muted" style={{ marginTop: 20 }}>Момент не найден.</p>
      </main>
    );

  const idx = trip.checkpoints.findIndex((c) => c.id === cp.id);
  const prev = trip.checkpoints[idx - 1];
  const next = trip.checkpoints[idx + 1];
  /**
   * Сохраняет ТОТ ЖЕ момент (тот же id) внутри той же поездки/события.
   * Для отдельного события его дата, название и место следуют за моментами,
   * чтобы событие переезжало в нужное место хронологии, «Этого дня» и поиска.
   */
  const save = (n: Checkpoint) => {
    const checkpoints = trip.checkpoints.map((c) => (c.id === n.id ? n : c));
    let next = { ...trip, checkpoints };
    if (isEvent(trip)) {
      const dates = checkpoints.map((c) => c.meta?.date ?? trip.date).sort();
      next = { ...next, date: dates[0] ?? trip.date, meta: { ...trip.meta, kind: "event" } };
      if (checkpoints.length === 1) {
        const only = checkpoints[0];
        const region = only.location?.label?.split(",").slice(1).join(",").trim();
        next = { ...next, title: only.title || trip.title, place: region || trip.place };
      }
    }
    void update(next);
  };
  const deleteMoment = async () => {
    const last = isEvent(trip) && trip.checkpoints.length === 1;
    const ok = confirm(
      last
        ? "Перенести это событие в корзину? Его можно восстановить в течение 30 дней (раздел «Я» → «Корзина»)."
        : "Удалить этот момент? Фото и видео останутся на Google Диске."
    );
    if (!ok) return;
    if (last) {
      await remove();
      router.replace(routes.home);
    } else {
      await update({ ...trip, checkpoints: trip.checkpoints.filter((c) => c.id !== cp.id) });
      router.replace(routes.trip(trip.id));
    }
  };
  const date = momentDate(trip, cp);
  const w = cp.meta?.weather;
  const current = visual[Math.min(i, Math.max(0, visual.length - 1))];
  const [short, ...regionParts] = (cp.location?.label ?? "").split(",");

  return (
    <main className="momentPage">
      <div
        className="momentHero"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (dx < -50 && i < visual.length - 1) setI(i + 1);
          if (dx > 50 && i > 0) setI(i - 1);
        }}
        style={{ ["--c" as string]: cp.style.color }}
      >
        {current ? <HeroMedia key={current.id} id={current.id} kind={current.kind} /> : cp.coverMediaId ? <MediaImg id={cp.coverMediaId} variant="original" /> : <span className="coverEmpty">{cp.icon ?? "📍"}</span>}
        <i className="coverShade top" />
        <div className="heroBar">
          <Link className="roundBtn" href={routes.trip(trip.id)} aria-label="Назад">
            <Icon name="back" />
          </Link>
          <span className="heroBarRight">
            <button className="pillBtn" onClick={() => setEdit(true)}>
              <Icon name="edit" size={16} /> Редактировать
            </button>
          </span>
        </div>
        {visual.length > 1 && (
          <>
            <span className="heroCounter">
              {Math.min(i, visual.length - 1) + 1}/{visual.length}
            </span>
            {i > 0 && (
              <button className="heroArrow left" aria-label="Предыдущее" onClick={() => setI(i - 1)}>
                <Icon name="back" />
              </button>
            )}
            {i < visual.length - 1 && (
              <button className="heroArrow right" aria-label="Следующее" onClick={() => setI(i + 1)}>
                <Icon name="chevron" />
              </button>
            )}
          </>
        )}
      </div>

      <section className="momentBody">
        <div className="mInfo">
          <div className="mPlace">
            <Icon name="pin" size={22} />
            <div>
              <strong>{short || cp.title}</strong>
              <span>{regionParts.length ? regionParts.join(",").trim() : short ? cp.title : trip.title}</span>
            </div>
            {w && (
              <span className="mWeather" title={w.label}>
                {w.icon} {w.temp > 0 ? "+" : ""}
                {w.temp}°
              </span>
            )}
          </div>
          {cp.meta?.address && (
            <div className="mDate">
              <Icon name="route" size={20} />
              <span>{cp.meta.address}</span>
            </div>
          )}
          <div className="mDate">
            <Icon name="calendar" size={20} />
            <span>{fullDate(date, cp.time)}</span>
          </div>
          {cp.description && <p className="mText">{cp.description}</p>}
        </div>

        <MediaGallery
          ids={cp.mediaIds}
          onRemove={(mid) => save(withRemovedMedia(cp, mid))}
          onSetCover={(mid) => save({ ...cp, coverMediaId: mid })}
          empty="Фото, видео и голос этого момента появятся здесь."
        />
        <MediaPicker compact onAdd={(items) => save(withAddedMedia(cp, items))} />

        {hasCoords(cp) && (
          <div className="miniMap">
            <LeafletMap interactive={false} points={[{ id: cp.id, lat: cp.location!.lat, lon: cp.location!.lon, color: cp.style.color, photoId: cp.coverMediaId, icon: cp.icon ?? "📍", label: short || cp.title }]} />
          </div>
        )}

        <Link className="mTrip" href={routes.trip(trip.id)}>
          <Icon name="route" size={18} /> {trip.title}
          <Icon name="chevron" size={16} />
        </Link>

        <div className="pointNav">
          <button className="navBtn" disabled={!prev} onClick={() => prev && router.replace(routes.moment(trip.id, prev.id))}>
            ‹ Раньше
          </button>
          <span className="muted small">
            {idx + 1} из {trip.checkpoints.length}
          </span>
          <button className="navBtn" disabled={!next} onClick={() => next && router.replace(routes.moment(trip.id, next.id))}>
            Дальше ›
          </button>
        </div>
      </section>

      {edit && (
        <Sheet onClose={() => setEdit(false)}>
          <CheckpointEditor
            value={cp}
            defaultDate={trip.date}
            onCancel={() => setEdit(false)}
            onSave={(n) => {
              save(n);
              setEdit(false);
            }}
            onDelete={cp.kind === "regular" ? deleteMoment : undefined}
          />
        </Sheet>
      )}
    </main>
  );
}

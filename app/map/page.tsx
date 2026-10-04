"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { Icon } from "@/components/Icon";
import { MediaImg } from "@/components/media/Media";
import type { MapLine, MapPoint } from "@/components/map/LeafletMap";
import { formatDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { hasCoords, isEvent, momentDate } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap").then((m) => m.LeafletMap), { ssr: false });

const TRIP_COLORS = ["#2f7bff", "#16b88a", "#ff8a1f", "#e0459b", "#f2b705", "#14a3c7", "#9b6bff", "#ef3b4a"];

function MapScreen() {
  const { trips } = useTrips();
  const onlyTrip = useSearchParams().get("trip");
  const [year, setYear] = useState<string>("all");
  const [sel, setSel] = useState<string | null>(null);

  const years = useMemo(() => Array.from(new Set((trips ?? []).map((t) => t.date.slice(0, 4)))).sort().reverse(), [trips]);
  const shown = useMemo(
    () => (trips ?? []).filter((t) => (onlyTrip ? t.id === onlyTrip : year === "all" || t.date.startsWith(year))),
    [trips, year, onlyTrip]
  );

  const { points, lines, index } = useMemo(() => {
    const points: MapPoint[] = [];
    const lines: MapLine[] = [];
    const index = new Map<string, { tripId: string; cpId: string }>();
    shown.forEach((t, ti) => {
      const color = TRIP_COLORS[ti % TRIP_COLORS.length];
      const located = t.checkpoints.filter(hasCoords);
      located.forEach((c) => {
        const id = `${t.id}:${c.id}`;
        index.set(id, { tripId: t.id, cpId: c.id });
        points.push({
          id,
          lat: c.location!.lat,
          lon: c.location!.lon,
          color: c.style.color,
          photoId: c.coverMediaId,
          icon: c.icon ?? "📍",
          label: located.length <= 1 || c.kind !== "regular" || c.coverMediaId ? (c.location?.label ?? c.title).split(",")[0] : undefined,
          big: c.kind === "end" || c.importance >= 2,
        });
      });
      if (!isEvent(t) && located.length > 1) lines.push({ id: t.id, color, coords: located.map((c) => [c.location!.lat, c.location!.lon]) });
    });
    return { points, lines, index };
  }, [shown]);

  const selected = sel ? index.get(sel) : null;
  const selTrip = selected ? shown.find((t) => t.id === selected.tripId) : null;
  const selCp = selTrip?.checkpoints.find((c) => c.id === selected?.cpId);
  const tripTitle = onlyTrip ? shown[0]?.title : null;

  return (
    <>
      <main className="mapScreen">
        <header className="mapHead">
          <Link className="roundBtn" href={onlyTrip ? routes.trip(onlyTrip) : routes.home} aria-label="Назад">
            <Icon name="back" />
          </Link>
          <h1>{tripTitle ?? "Карта"}</h1>
          <span className="roundBtn ghostBtn" aria-hidden>
            <Icon name="layers" />
          </span>
        </header>

        {trips && <LeafletMap points={points} lines={lines} onSelect={setSel} />}

        {trips && points.length === 0 && (
          <div className="mapEmpty">
            <strong>Пока нет мест на карте</strong>
            <span>Укажите место у момента (поиск или «Я здесь») — и он появится здесь вместе с маршрутом поездки.</span>
            <Link className="primary" href={routes.newMoment()}>+ Новый момент</Link>
          </div>
        )}

        {!onlyTrip && years.length > 0 && (
          <div className="yearChips">
            <button className={year === "all" ? "on" : ""} onClick={() => setYear("all")}>
              Все поездки
            </button>
            {years.map((y) => (
              <button key={y} className={year === y ? "on" : ""} onClick={() => setYear(y)}>
                {y}
              </button>
            ))}
          </div>
        )}

        {selTrip && selCp && (
          <Link className="mapCard" href={routes.moment(selTrip.id, selCp.id)}>
            <span className="mcThumb" style={{ background: selCp.style.color }}>
              {selCp.coverMediaId ? <MediaImg id={selCp.coverMediaId} /> : <span>{selCp.icon ?? "📍"}</span>}
            </span>
            <span className="mcText">
              <strong>{selCp.title}</strong>
              <span>{selCp.location?.label}</span>
              <span className="muted small">
                {formatDate(momentDate(selTrip, selCp))} · {selTrip.title}
              </span>
            </span>
            <button
              className="mcClose"
              aria-label="Закрыть"
              onClick={(e) => {
                e.preventDefault();
                setSel(null);
              }}
            >
              ×
            </button>
          </Link>
        )}
      </main>
      <BottomNav />
    </>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapScreen />
    </Suspense>
  );
}

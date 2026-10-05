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
import { TagFilter } from "@/components/Tags";
import { routeCoords } from "@/lib/gpx";
import { useUserData } from "@/lib/userdata";
import { allTags, cpHasTag, tripHasTag } from "@/lib/tags";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap").then((m) => m.LeafletMap), { ssr: false });

const TRIP_COLORS = ["#2f7bff", "#16b88a", "#ff8a1f", "#e0459b", "#f2b705", "#14a3c7", "#9b6bff", "#ef3b4a"];

function MapScreen() {
  const { trips } = useTrips();
  const onlyTrip = useSearchParams().get("trip");
  const [year, setYear] = useState<string>("all");
  const [sel, setSel] = useState<string | null>(null);
  const [base, setBase] = useState<"map" | "satellite">("map");
  const [tag, setTag] = useState<string | null>(null);
  const [heatMode, setHeatMode] = useState(false);
  const [showWishes, setShowWishes] = useState(true);
  const { data: user } = useUserData();
  const tags = useMemo(() => allTags(trips ?? []), [trips]);

  const years = useMemo(() => Array.from(new Set((trips ?? []).map((t) => t.date.slice(0, 4)))).sort().reverse(), [trips]);
  const shown = useMemo(
    () => (trips ?? []).filter((t) => (onlyTrip ? t.id === onlyTrip : year === "all" || t.date.startsWith(year)) && tripHasTag(t, tag)),
    [trips, year, onlyTrip, tag]
  );

  const { points, lines, index } = useMemo(() => {
    const points: MapPoint[] = [];
    const lines: MapLine[] = [];
    const index = new Map<string, { tripId: string; cpId: string }>();
    shown.forEach((t, ti) => {
      const color = TRIP_COLORS[ti % TRIP_COLORS.length];
      const located = t.checkpoints.filter((c) => hasCoords(c) && cpHasTag(c, tag));
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
      const track = routeCoords(t.route);
      if (track.length > 1 && !tag) lines.push({ id: t.id, color, coords: track });
      else if (!isEvent(t) && located.length > 1) lines.push({ id: t.id, color, coords: located.map((c) => [c.location!.lat, c.location!.lon]) });
    });
    return { points, lines, index };
  }, [shown]);

  const wishes = useMemo(() => (user?.wishes ?? []).filter((w) => !w.doneTripId && w.location && (w.location.lat || w.location.lon)), [user]);
  const wishPoints: MapPoint[] = !onlyTrip && showWishes ? wishes.map((w) => ({ id: `wish:${w.id}`, lat: w.location!.lat, lon: w.location!.lon, color: "#ffc531", icon: "⭐", label: w.title })) : [];
  const heat = useMemo(() => (heatMode ? shown.flatMap((t) => t.checkpoints.filter(hasCoords).map((c) => [c.location!.lat, c.location!.lon] as [number, number])) : []), [heatMode, shown]);
  const selWish = sel?.startsWith("wish:") ? wishes.find((w) => `wish:${w.id}` === sel) : null;
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
          <button className={`roundBtn ${base === "satellite" ? "accent" : ""}`} aria-label="Спутник или схема" onClick={() => setBase(base === "map" ? "satellite" : "map")}>
            <Icon name="layers" />
          </button>
        </header>

        {trips && <LeafletMap points={heatMode ? wishPoints : [...points, ...wishPoints]} lines={heatMode ? [] : lines} heat={heat} onSelect={setSel} base={base} />}

        {trips && points.length === 0 && (
          <div className="mapEmpty">
            <strong>Пока нет мест на карте</strong>
            <span>Укажите место у момента (поиск или «Я здесь») — и он появится здесь вместе с маршрутом поездки.</span>
            <Link className="primary" href={routes.newMoment()}>+ Новый момент</Link>
          </div>
        )}

        {!onlyTrip && tags.length > 0 && (
          <div className="mapTags">
            <TagFilter tags={tags} value={tag} onChange={setTag} />
          </div>
        )}

        {!onlyTrip && years.length > 0 && (
          <div className="yearChips">
            <button className={heatMode ? "on" : ""} onClick={() => setHeatMode((v) => !v)}>
              🔥 Тепловая
            </button>
            {wishes.length > 0 && (
              <button className={showWishes ? "on" : ""} onClick={() => setShowWishes((v) => !v)}>
                ⭐ Хочу поехать
              </button>
            )}
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

        {selWish && (
          <div className="mapCard">
            <Link className="mcLink" href={routes.wishes}>
            <span className="mcThumb" style={{ background: "#ffc531" }}>
              <span>⭐</span>
            </span>
            <span className="mcText">
              <strong>{selWish.title}</strong>
              <span>{selWish.location?.label}</span>
              <span className="muted small">Хочу поехать · открыть список</span>
            </span>
            </Link>
            <button className="mcClose" aria-label="Закрыть" onClick={() => setSel(null)}>
              ×
            </button>
          </div>
        )}

        {selTrip && selCp && (
          <div className="mapCard">
            <Link className="mcLink" href={routes.moment(selTrip.id, selCp.id)}>
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
            </Link>
            <button className="mcClose" aria-label="Закрыть" onClick={() => setSel(null)}>
              ×
            </button>
          </div>
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

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DestinationCard } from "@/components/story/DestinationCard";
import { StoryPointModal } from "@/components/story/StoryPointModal";
import { JourneyStrip } from "@/components/story/JourneyStrip";
import { StoryRoute } from "@/components/story/StoryRoute";
import { Sheet } from "@/components/Sheet";
import { TripEditor } from "@/components/TripEditor";
import { MediaGallery, MediaImg, MediaPicker } from "@/components/media/Media";
import { useMediaMetas } from "@/components/media/useMedia";
import { withAddedMedia } from "@/components/CheckpointEditor";
import { Icon } from "@/components/Icon";
import dynamic from "next/dynamic";
import { fmtKm, hasCoords, isEvent, kmByMode, tripCover, tripDateRange, tripDays, tripKm, tripMediaIds, tripPlaces } from "@/lib/stats";
import { TRAVEL } from "@/lib/travel";
import { formatDate, formatDuration, minutesOf, plural } from "@/lib/format";
import { createCheckpoint } from "@/lib/markerStyle";
import { useTrip } from "@/lib/useTrip";
import { routes } from "@/lib/routes";
import type { Checkpoint, TravelMode, Trip } from "@/lib/types";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap").then((m) => m.LeafletMap), { ssr: false });

type Tab = "overview" | "route" | "photos" | "videos" | "moments";

/** Плитки «дней · км · мест · фото · видео» — только реальные цифры. */
function TripStatTiles({ trip }: { trip: Trip }) {
  const metas = useMediaMetas(tripMediaIds(trip));
  const km = tripKm(trip);
  const tiles = [
    !isEvent(trip) ? { icon: "calendar", value: tripDays(trip), label: plural(tripDays(trip), "день", "дня", "дней"), color: "#ffc531" } : null,
    km != null && km >= 0.1 ? { icon: "route", value: km >= 10 ? Math.round(km) : Number(km.toFixed(1)), label: "км", color: "#16c79a" } : null,
    { icon: "pin", value: tripPlaces(trip) || trip.checkpoints.length, label: plural(tripPlaces(trip) || trip.checkpoints.length, "место", "места", "мест"), color: "#2f7bff" },
    { icon: "photo", value: metas.filter((m) => m.kind === "image").length, label: "фото", color: "#b46bff" },
    { icon: "video", value: metas.filter((m) => m.kind === "video").length, label: "видео", color: "#ff4d5e" },
  ].filter(Boolean) as { icon: string; value: number; label: string; color: string }[];
  const modes = isEvent(trip) ? [] : kmByMode([trip]).filter((m) => m.mode !== "other");
  return (
    <>
    <div className="statTiles">
      {tiles.map((t) => (
        <div key={t.label + t.icon} className="statTile" style={{ ["--tc" as string]: t.color }}>
          <Icon name={t.icon} size={22} />
          <strong>{t.value}</strong>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
    {modes.length > 0 && (
      <p className="modeLine">
        {modes.map((m) => `${TRAVEL[m.mode as TravelMode]?.icon ?? ""} ${fmtKm(m.km)} км`).join("   ")}
      </p>
    )}
    </>
  );
}

/** «Лучшие моменты»: сначала важные точки с фото, затем остальные снимки поездки. */
function BestMoments({ trip, onAll }: { trip: Trip; onAll: () => void }) {
  const ordered = [...trip.checkpoints].filter((c) => c.coverMediaId).sort((a, b) => b.importance - a.importance);
  if (!ordered.length) return null;
  return (
    <div className="bestMoments">
      <div className="sectionHead">
        <h2>Лучшие моменты</h2>
        <button className="linkBtn" onClick={onAll}>
          Все <Icon name="chevron" size={16} />
        </button>
      </div>
      <div className="hScroll">
        {ordered.slice(0, 10).map((c) => (
          <Link key={c.id} className="bestTile" href={routes.moment(trip.id, c.id)}>
            <MediaImg id={c.coverMediaId} />
            <span>{c.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function TripView() {
  const id = useSearchParams().get("id") ?? undefined;
  const router = useRouter();
  const { trip, status, error, saving, update, remove } = useTrip(id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [editTrip, setEditTrip] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const stats = useMemo(() => {
    if (!trip) return null;
    const times = trip.checkpoints.map((c) => minutesOf(c.place?.leftAt ?? c.time)).filter((v): v is number => v != null);
    const first = minutesOf(trip.checkpoints[0]?.time);
    const span = first != null && times.length > 1 ? Math.max(...times) - first : null;
    const media = trip.checkpoints.reduce((s, c) => s + c.mediaIds.length, trip.mediaIds.length);
    return { span, media, points: trip.checkpoints.length };
  }, [trip]);

  if (status === "loading") return <main className="shell"><p className="muted">Загрузка…</p></main>;
  if (!trip)
    return (
      <main className="shell">
        <Link className="backLink" href="/">← Назад</Link>
        <p className="muted" style={{ marginTop: 20 }}>Поездка не найдена{error ? `: ${error}` : ""}.</p>
      </main>
    );

  const cps = trip.checkpoints;
  const openIndex = cps.findIndex((c) => c.id === openId);
  const openCp = openIndex >= 0 ? cps[openIndex] : null;
  const end = cps.find((c) => c.kind === "end");

  const saveCp = (cp: Checkpoint) => update({ ...trip, checkpoints: cps.map((c) => (c.id === cp.id ? cp : c)) });
  const deleteCp = (cid: string) => {
    update({ ...trip, checkpoints: cps.filter((c) => c.id !== cid) });
    setOpenId(null);
  };
  const moveCp = (cid: string, dir: -1 | 1) => {
    const i = cps.findIndex((c) => c.id === cid);
    const j = i + dir;
    if (j < 0 || j >= cps.length || cps[j].kind !== "regular") return;
    const next = [...cps];
    [next[i], next[j]] = [next[j], next[i]];
    update({ ...trip, checkpoints: next });
  };
  const addPoint = () => {
    const cp = createCheckpoint("regular");
    const next = [...cps];
    const endIdx = next.findIndex((c) => c.kind === "end");
    next.splice(endIdx >= 0 ? endIdx : next.length, 0, cp);
    update({ ...trip, checkpoints: next });
    setNewId(cp.id);
    setOpenId(cp.id);
  };
  const openPoint = (cp: Checkpoint) => {
    if (cp.kind === "end" && cp.place) router.push(routes.place(trip.id, cp.id));
    else setOpenId(cp.id);
  };

  const event = isEvent(trip);
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Обзор" },
    ...(event ? [] : [{ id: "route" as Tab, label: "Маршрут" }]),
    { id: "photos", label: "Фото" },
    { id: "videos", label: "Видео" },
    { id: "moments", label: "Моменты" },
  ];
  const located = cps.filter(hasCoords);

  return (
    <main className="tripPage v2">
      <div className="tripHero">
        <div className="coverBg" style={{ ["--c" as string]: end?.style.color ?? "#2f7bff" }}>
          {tripCover(trip) ? <MediaImg id={tripCover(trip)} variant="original" /> : <span className="coverEmpty">{cps.find((c) => c.icon)?.icon ?? "🗺"}</span>}
          <i className="coverShade" />
        </div>
        <div className="heroBar">
          <Link className="roundBtn" href="/" aria-label="Назад">
            <Icon name="back" />
          </Link>
          <span className="heroBarRight">
            <button className="pillBtn" onClick={() => setEditTrip(true)}>
              Изменить
            </button>
          </span>
        </div>
        <div className="heroTitle">
          {event && <span className="kindTag">Событие</span>}
          <h1>{trip.title}</h1>
          <p>
            {tripDateRange(trip)}
            {trip.place ? ` · ${trip.place}` : ""}
            {saving ? " · сохраняю…" : ""}
          </p>
        </div>
      </div>

      {error && <p className="errorBar">{error}</p>}

      <div className="tabsRow" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="tabBody">
          <TripStatTiles trip={trip} />
          {trip.description && <p className="tripDesc">{trip.description}</p>}
          {located.length > 0 && (
            <div className="miniMap">
              <LeafletMap
                interactive={false}
                labels={false}
                points={located.map((c) => ({ id: c.id, lat: c.location!.lat, lon: c.location!.lon, color: c.style.color, photoId: c.coverMediaId, icon: c.icon ?? "📍", big: c.kind === "end" }))}
                lines={event || located.length < 2 ? [] : [{ id: trip.id, color: "#2f7bff", coords: located.map((c) => [c.location!.lat, c.location!.lon]) }]}
              />
              <Link className="mapExpand" href={`${routes.map}?trip=${encodeURIComponent(trip.id)}`} aria-label="Открыть на карте">
                <Icon name="map" size={18} />
              </Link>
            </div>
          )}
          <BestMoments trip={trip} onAll={() => setTab("photos")} />
          {cps.length === 0 && (
            <Link className="primary wide" href={routes.newMoment(trip.id)}>
              + Добавить первый момент
            </Link>
          )}
        </section>
      )}

      {tab === "route" && (
        <section className="tabBody">
          <JourneyStrip points={cps} onOpen={(cp) => setOpenId(cp.id)} />
          <section className="storySection">
            <StoryRoute trip={trip} onOpen={openPoint} />
            <button className="addPointBtn" onClick={addPoint}>+ Добавить точку</button>
            {end?.place && <DestinationCard cp={end} onOpen={() => router.push(routes.place(trip.id, end.id))} />}
          </section>
        </section>
      )}

      {tab === "photos" && (
        <section className="tabBody">
          <MediaPicker kinds={["image"]} onAdd={(items) => update(withAddedMedia(trip, items))} />
          <MediaGallery ids={tripMediaIds(trip)} kinds={["image"]} empty="Фотографий пока нет." />
        </section>
      )}

      {tab === "videos" && (
        <section className="tabBody">
          <MediaPicker kinds={["video"]} onAdd={(items) => update(withAddedMedia(trip, items))} />
          <MediaGallery ids={tripMediaIds(trip)} kinds={["video"]} empty="Видео пока нет." />
        </section>
      )}

      {tab === "moments" && (
        <section className="tabBody">
          <div className="momentList">
            {cps.map((c) => (
              <Link key={c.id} className="momentRow" href={routes.moment(trip.id, c.id)}>
                <span className="mrThumb" style={{ background: c.style.color }}>
                  {c.coverMediaId ? <MediaImg id={c.coverMediaId} /> : <span>{c.icon ?? "📍"}</span>}
                </span>
                <span className="mrText">
                  <strong>{c.title}</strong>
                  <span className="muted small">
                    {[c.meta?.date && c.meta.date !== trip.date ? formatDate(c.meta.date) : null, c.time, c.location?.label].filter(Boolean).join(" · ")}
                  </span>
                  {c.description && <span className="small clamp2 mrDesc">{c.description}</span>}
                </span>
                {c.meta?.weather && (
                  <span className="mrWeather">
                    {c.meta.weather.icon} {c.meta.weather.temp > 0 ? "+" : ""}
                    {c.meta.weather.temp}°
                  </span>
                )}
              </Link>
            ))}
          </div>
          <Link className="addPointBtn linkBtnBlock" href={routes.newMoment(trip.id)}>
            + Добавить момент
          </Link>
        </section>
      )}

      {openCp && (
        <StoryPointModal
          key="point-modal"
          defaultDate={trip.date}
          cp={openCp}
          index={openIndex}
          total={cps.length}
          startInEdit={openCp.id === newId}
          onClose={() => {
            setOpenId(null);
            setNewId(null);
          }}
          onSave={(cp) => {
            saveCp(cp);
            setNewId(null);
          }}
          onDelete={deleteCp}
          onMove={moveCp}
          onOpenPlace={(cid) => router.push(routes.place(trip.id, cid))}
          onNavigate={(i) => {
            const next = cps[i];
            if (next) {
              setNewId(null);
              setOpenId(next.id);
            }
          }}
        />
      )}

      {editTrip && (
        <Sheet onClose={() => setEditTrip(false)}>
          <TripEditor
            value={trip}
            onCancel={() => setEditTrip(false)}
            onSave={(t) => {
              update(t);
              setEditTrip(false);
            }}
            onDelete={async () => {
              await remove();
              router.push("/");
            }}
          />
        </Sheet>
      )}
    </main>
  );
}

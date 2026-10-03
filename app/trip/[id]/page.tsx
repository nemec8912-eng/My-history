"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DestinationCard } from "@/components/story/DestinationCard";
import { StoryPointModal } from "@/components/story/StoryPointModal";
import { StoryRoute } from "@/components/story/StoryRoute";
import { TripMap } from "@/components/map/TripMap";
import { Sheet } from "@/components/Sheet";
import { TripEditor } from "@/components/TripEditor";
import { MediaImg } from "@/components/media/Media";
import { formatDate, formatDuration, minutesOf, plural } from "@/lib/format";
import { createCheckpoint } from "@/lib/markerStyle";
import { useTrip } from "@/lib/useTrip";
import type { Checkpoint } from "@/lib/types";

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { trip, status, error, saving, update, remove } = useTrip(id);
  const [tab, setTab] = useState<"story" | "map">("story");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [editTrip, setEditTrip] = useState(false);
  const [pickFor, setPickFor] = useState<string>("");

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
    if (j <= 0 || j >= cps.length - 1 || cps[j].kind !== "regular") return;
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
    if (cp.kind === "end" && cp.place) router.push(`/trip/${trip.id}/place/${cp.id}`);
    else setOpenId(cp.id);
  };

  return (
    <main className="tripPage">
      <header className="tripTop">
        <Link className="roundBtn" href="/" aria-label="Назад">←</Link>
        <div className="tripTitle">
          <h1>{trip.title}</h1>
          <p className="muted">
            {formatDate(trip.date)}
            {trip.place ? ` · ${trip.place}` : ""}
            {saving ? " · сохраняю…" : ""}
          </p>
        </div>
        <button className="roundBtn accent" onClick={() => setEditTrip(true)} aria-label="Изменить поездку">✎</button>
      </header>

      {error && <p className="errorBar">{error}</p>}

      {trip.coverMediaId && (
        <div className="tripCover">
          <MediaImg id={trip.coverMediaId} variant="original" />
        </div>
      )}

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === "map"} className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>Карта</button>
        <button role="tab" aria-selected={tab === "story"} className={tab === "story" ? "on" : ""} onClick={() => setTab("story")}>История</button>
      </div>

      {stats && (
        <div className="tripStats">
          <span><strong>{stats.points}</strong> {plural(stats.points, "точка", "точки", "точек")}</span>
          <span><strong>{stats.media}</strong> {plural(stats.media, "файл", "файла", "файлов")}</span>
          {stats.span != null && stats.span > 0 && <span><strong>{formatDuration(stats.span)}</strong> в пути</span>}
        </div>
      )}

      {tab === "story" ? (
        <section className="storySection">
          {trip.description && <p className="tripDesc">{trip.description}</p>}
          <StoryRoute trip={trip} onOpen={openPoint} />
          <button className="addPointBtn" onClick={addPoint}>+ Добавить точку</button>
          {end?.place && <DestinationCard cp={end} onOpen={() => router.push(`/trip/${trip.id}/place/${end.id}`)} />}
        </section>
      ) : (
        <section className="mapSection">
          <div className="pickBar">
            <select value={pickFor} onChange={(e) => setPickFor(e.target.value)}>
              <option value="">Поставить точку на карте…</option>
              {cps.map((c, i) => (
                <option key={c.id} value={c.id}>{i + 1}. {c.title}</option>
              ))}
            </select>
            {pickFor && <span className="muted small">Коснитесь карты</span>}
          </div>
          <TripMap
            trip={trip}
            picking={Boolean(pickFor)}
            onMarkerClick={(cid) => setOpenId(cid)}
            onMapClick={(lat, lon) => {
              if (!pickFor) return;
              update({
                ...trip,
                checkpoints: cps.map((c) => (c.id === pickFor ? { ...c, location: { ...c.location, lat, lon } } : c)),
              });
              setPickFor("");
            }}
          />
          <p className="muted small">Построение маршрута по адресам через 2ГИС — следующий шаг.</p>
        </section>
      )}

      {openCp && (
        <StoryPointModal
          key={openCp.id}
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
          onOpenPlace={(cid) => router.push(`/trip/${trip.id}/place/${cid}`)}
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

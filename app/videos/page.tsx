"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TabScreen } from "@/components/BottomNav";
import { MomentsTabs } from "@/components/MomentsTabs";
import { MediaGallery } from "@/components/media/Media";
import { useMediaMetas } from "@/components/media/useMedia";
import { collectMedia, monthLabel } from "@/lib/collect";
import { routes } from "@/lib/routes";
import { useTrips } from "@/lib/useTrips";

/** Видео (экран 8): все ролики или по поездкам; миниатюры с длительностью. */
export default function VideosPage() {
  const { trips } = useTrips();
  const [mode, setMode] = useState<"all" | "trips">("all");
  const refs = useMemo(() => collectMedia(trips ?? []), [trips]);
  const metas = useMediaMetas(refs.map((r) => r.id));
  const videoIds = useMemo(() => new Set(metas.filter((m) => m.kind === "video").map((m) => m.id)), [metas]);
  const videos = refs.filter((r) => videoIds.has(r.id));
  const byTrip = useMemo(() => {
    const out: { id: string; label: string; ids: string[] }[] = [];
    for (const r of videos) {
      let g = out.find((x) => x.id === r.trip.id);
      if (!g) {
        g = { id: r.trip.id, label: `${r.trip.title} · ${monthLabel(r.date)}`, ids: [] };
        out.push(g);
      }
      g.ids.push(r.id);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length, refs]);

  return (
    <TabScreen className="videosPage">
      <header className="appHeader">
        <span className="ahSide" />
        <h1>Видео</h1>
        <span className="ahSide right" />
      </header>
      <MomentsTabs active="videos" />
      <div className="filterTabs">
        <button className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>
          Все
        </button>
        <button className={mode === "trips" ? "on" : ""} onClick={() => setMode("trips")}>
          По поездкам
        </button>
      </div>
      {videos.length === 0 && trips && metas.length >= refs.length && <p className="muted">Видео пока нет. Добавьте ролик в момент — он появится здесь.</p>}
      {mode === "all" ? (
        <MediaGallery ids={videos.map((v) => v.id)} kinds={["video"]} />
      ) : (
        byTrip.map((g) => (
          <section key={g.id} className="photoGroup">
            <Link className="pgLabel" href={routes.trip(g.id)}>
              {g.label}
            </Link>
            <MediaGallery ids={g.ids} kinds={["video"]} />
          </section>
        ))
      )}
    </TabScreen>
  );
}

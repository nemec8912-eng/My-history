"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TabScreen } from "@/components/BottomNav";
import { MomentsTabs } from "@/components/MomentsTabs";
import { MediaGallery, MediaImg } from "@/components/media/Media";
import { useMediaMetas } from "@/components/media/useMedia";
import { collectMedia, monthLabel, type MediaRef } from "@/lib/collect";
import { routes } from "@/lib/routes";
import { momentDate } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";

type F = "all" | "image" | "video" | "moments";

/** Все фотографии (экран 7): группы «Месяц Год · Поездка», полноэкранный просмотр. */
export default function PhotosPage() {
  const { trips } = useTrips();
  const [f, setF] = useState<F>("image");
  const refs = useMemo(() => collectMedia(trips ?? []), [trips]);
  const metas = useMediaMetas(refs.map((r) => r.id));
  const kindOf = useMemo(() => new Map(metas.map((m) => [m.id, m.kind])), [metas]);

  const groups = useMemo(() => {
    const list = refs.filter((r) => {
      const k = kindOf.get(r.id);
      return f === "all" ? k !== "audio" : k === f;
    });
    const out: { key: string; label: string; tripId: string; items: MediaRef[] }[] = [];
    for (const r of list) {
      const key = `${r.date.slice(0, 7)}:${r.trip.id}`;
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, label: `${monthLabel(r.date)} · ${r.trip.title}`, tripId: r.trip.id, items: [] };
        out.push(g);
      }
      g.items.push(r);
    }
    return out;
  }, [refs, kindOf, f]);

  const moments = useMemo(
    () =>
      (trips ?? [])
        .flatMap((t) => t.checkpoints.filter((c) => c.coverMediaId).map((c) => ({ t, c })))
        .sort((a, b) => momentDate(b.t, b.c).localeCompare(momentDate(a.t, a.c))),
    [trips]
  );

  return (
    <TabScreen className="photosPage">
      <header className="appHeader">
        <span className="ahSide" />
        <h1>Моменты</h1>
        <span className="ahSide right" />
      </header>
      <MomentsTabs active="photos" />
      <div className="filterTabs">
        {(
          [
            ["all", "Все"],
            ["image", "Фото"],
            ["video", "Видео"],
            ["moments", "Моменты"],
          ] as [F, string][]
        ).map(([id, label]) => (
          <button key={id} className={f === id ? "on" : ""} onClick={() => setF(id)}>
            {label}
          </button>
        ))}
      </div>

      {f === "moments" ? (
        <div className="momentGrid">
          {moments.map(({ t, c }) => (
            <Link key={c.id} className="momentTile" href={routes.moment(t.id, c.id)}>
              <MediaImg id={c.coverMediaId} />
              <span>{c.title}</span>
            </Link>
          ))}
          {moments.length === 0 && <p className="muted">Моменты с фото появятся здесь.</p>}
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.key} className="photoGroup">
              <Link className="pgLabel" href={routes.trip(g.tripId)}>
                {g.label}
              </Link>
              <MediaGallery ids={g.items.map((i) => i.id)} kinds={f === "all" ? ["image", "video"] : [f]} />
            </section>
          ))}
          {trips && groups.length === 0 && <p className="muted">Пока пусто. Добавьте фото в момент или поездку.</p>}
        </>
      )}
    </TabScreen>
  );
}

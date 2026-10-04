"use client";

import Link from "next/link";
import { useMemo } from "react";
import { TabScreen } from "@/components/BottomNav";
import { MomentsTabs } from "@/components/MomentsTabs";
import { MediaImg } from "@/components/media/Media";
import { useMediaMetas } from "@/components/media/useMedia";
import { collectMedia, MONTHS_NOM } from "@/lib/collect";
import { plural } from "@/lib/format";
import { routes } from "@/lib/routes";
import { isEvent, tripCover, tripDays, tripMediaIds } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";
import type { Trip } from "@/lib/types";

function TripLine({ t }: { t: Trip }) {
  const metas = useMediaMetas(tripMediaIds(t));
  const photos = metas.filter((m) => m.kind === "image").length;
  const days = tripDays(t);
  const cover = tripCover(t);
  const region = t.place || t.checkpoints.find((c) => c.location?.label)?.location?.label?.split(",").slice(-1)[0]?.trim();
  return (
    <Link className="tlTrip" href={routes.trip(t.id)}>
      <span className="tlDot" aria-hidden />
      <span className="tlText">
        <strong>{t.title}</strong>
        {region && <span>{region}</span>}
        <span className="muted">
          {isEvent(t) ? "Событие" : `${days} ${plural(days, "день", "дня", "дней")}`}
          {photos ? ` · ${photos} фото` : ""}
        </span>
      </span>
      <span className="tlThumb">{cover ? <MediaImg id={cover} /> : <span>{t.checkpoints.find((c) => c.icon)?.icon ?? "🗺"}</span>}</span>
    </Link>
  );
}

function YearHead({ year, trips }: { year: string; trips: Trip[] }) {
  const metas = useMediaMetas(collectMedia(trips).map((m) => m.id));
  const photos = metas.filter((m) => m.kind === "image").length;
  const videos = metas.filter((m) => m.kind === "video").length;
  const nTrips = trips.filter((t) => !isEvent(t)).length;
  const nEvents = trips.length - nTrips;
  const parts = [
    nTrips ? `${nTrips} ${plural(nTrips, "поездка", "поездки", "поездок")}` : null,
    nEvents ? `${nEvents} ${plural(nEvents, "событие", "события", "событий")}` : null,
    photos ? `${photos} фото` : null,
    videos ? `${videos} видео` : null,
  ].filter(Boolean);
  return (
    <div className="tlYear">
      <span className="tlYearDot" aria-hidden />
      <div>
        <h2>{year}</h2>
        <span className="muted small">{parts.join(" · ")}</span>
      </div>
    </div>
  );
}

/** Хронология по годам (экран 6): год → месяц → поездки и события. */
export default function TimelinePage() {
  const { trips } = useTrips();
  const years = useMemo(() => {
    const map = new Map<string, Map<string, Trip[]>>();
    for (const t of trips ?? []) {
      const y = t.date.slice(0, 4);
      const m = t.date.slice(5, 7);
      if (!map.has(y)) map.set(y, new Map());
      const ym = map.get(y)!;
      if (!ym.has(m)) ym.set(m, []);
      ym.get(m)!.push(t);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([y, months]) => ({ y, months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])) }));
  }, [trips]);

  return (
    <TabScreen className="timelinePage">
      <header className="appHeader">
        <span className="ahSide" />
        <h1>Моменты</h1>
        <span className="ahSide right" />
      </header>
      <MomentsTabs active="timeline" />
      {trips && trips.length === 0 && <p className="muted">Здесь появится лента ваших воспоминаний по годам.</p>}
      <div className="timeline2">
        {years.map(({ y, months }) => (
          <section key={y} className="tlSection">
            <YearHead year={y} trips={months.flatMap(([, ts]) => ts)} />
            {months.map(([m, ts]) => (
              <div key={m} className="tlMonth">
                <p className="tlMonthLabel">{MONTHS_NOM[Number(m) - 1]}</p>
                {ts.map((t) => (
                  <TripLine key={t.id} t={t} />
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
    </TabScreen>
  );
}

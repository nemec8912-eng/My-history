"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { Icon } from "@/components/Icon";
import { MediaImg } from "@/components/media/Media";
import { useMediaMetas } from "@/components/media/useMedia";
import { routes } from "@/lib/routes";
import { plural } from "@/lib/format";
import { fmtKm, isEvent, momentDate, tripCover, tripDateRange, tripKm, tripMediaIds } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";
import type { Trip } from "@/lib/types";
import { BackLink } from "@/components/BackLink";

const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const nice = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return y ? `${day} ${RU_MONTHS_GEN[m - 1]} ${y}` : d;
};

function TripPages({ trip, kinds }: { trip: Trip; kinds: Map<string, string> }) {
  const km = tripKm(trip);
  return (
    <section className="bkTrip">
      <div className="bkTripHead">
        {tripCover(trip) && (
          <div className="bkHero">
            <MediaImg id={tripCover(trip)} variant="original" />
          </div>
        )}
        <h2>{trip.title}</h2>
        <p className="bkSub">
          {isEvent(trip) ? "Событие" : "Поездка"} · {tripDateRange(trip)}
          {trip.place ? ` · ${trip.place}` : ""}
          {km && km >= 0.1 && !isEvent(trip) ? ` · ${fmtKm(km)} км` : ""}
        </p>
        {trip.description && <p>{trip.description}</p>}
      </div>
      {trip.checkpoints.map((c) => {
        const photos = Array.from(new Set([c.coverMediaId, ...c.mediaIds].filter(Boolean) as string[])).filter((id) => kinds.get(id) === "image").slice(0, 6);
        if (!photos.length && !c.description && c.kind !== "regular") return null;
        return (
          <article key={c.id} className="bkMoment">
            <h3>
              {c.meta?.mood ? `${c.meta.mood} ` : ""}
              {c.title}
            </h3>
            <p className="bkSub">
              {nice(momentDate(trip, c))}
              {c.time ? `, ${c.time}` : ""}
              {c.location?.label ? ` · ${c.location.label}` : ""}
            </p>
            {c.description && <p>{c.description}</p>}
            {photos.length > 0 && (
              <div className={`bkPhotos n${Math.min(photos.length, 4)}`}>
                {photos.map((id) => (
                  <MediaImg key={id} id={id} variant="original" />
                ))}
              </div>
            )}
          </article>
        );
      })}
      {(() => {
        const inMoments = new Set(trip.checkpoints.flatMap((c) => [c.coverMediaId, ...c.mediaIds]));
        const extra = trip.mediaIds.filter((id) => !inMoments.has(id) && kinds.get(id) === "image").slice(0, 12);
        if (!extra.length) return null;
        return (
          <article className="bkMoment">
            <h3>Фото поездки</h3>
            <div className={`bkPhotos n${Math.min(extra.length, 4)}`}>
              {extra.map((id) => (
                <MediaImg key={id} id={id} variant="original" />
              ))}
            </div>
          </article>
        );
      })()}
    </section>
  );
}

/** Фотокнига: поездка или целый год, свёрстанные под печать или сохранение в PDF. */
function Book() {
  const sp = useSearchParams();
  const tripId = sp.get("trip");
  const year = sp.get("y");
  const { trips } = useTrips();
  const list = useMemo(
    () =>
      (trips ?? [])
        .filter((t) => (tripId ? t.id === tripId : year ? t.date.startsWith(year) || t.checkpoints.some((c) => momentDate(t, c).startsWith(year)) : false))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [trips, tripId, year]
  );
  const metas = useMediaMetas(useMemo(() => list.flatMap(tripMediaIds), [list]));
  const kinds = useMemo(() => new Map(metas.map((m) => [m.id, m.kind])), [metas]);
  const title = tripId ? list[0]?.title : `${year} год`;
  const cover = tripId ? list[0] && tripCover(list[0]) : list.map(tripCover).find(Boolean);
  const photoCount = metas.filter((m) => m.kind === "image").length;

  return (
    <main className="bookPage">
      <header className="nmHead noPrint">
        <BackLink href={tripId ? routes.trip(tripId) : routes.year(year ?? undefined)} className="iconBtnPlain">
          <Icon name="back" />
        </BackLink>
        <h1>Фотокнига</h1>
        <span style={{ width: 40 }} />
      </header>
      <div className="noPrint bkTools">
        <button className="primary" onClick={() => window.print()} disabled={!list.length}>
          Сохранить PDF / напечатать
        </button>
        <p className="hint">Дождитесь, пока загрузятся все фото. В окне печати выберите «Сохранить как PDF» (на iPhone — «Поделиться» → «Сохранить в Файлы»).</p>
      </div>
      {trips === null && <p className="muted">Загрузка…</p>}
      {trips && list.length === 0 && <p className="muted">Нечего показать.</p>}
      {list.length > 0 && (
        <div className="bkPages">
          <section className="bkCover">
            {cover && <MediaImg id={cover} variant="original" />}
            <div className="bkCoverText">
              <span>Моя история</span>
              <h1>{title}</h1>
              <p>
                {tripId ? tripDateRange(list[0]) : `${list.length} ${plural(list.length, "поездка или событие", "поездки и события", "поездок и событий")}`} · {photoCount} фото
              </p>
            </div>
          </section>
          {list.map((t) => (
            <TripPages key={t.id} trip={t} kinds={kinds} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={null}>
      <Book />
    </Suspense>
  );
}

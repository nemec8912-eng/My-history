"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { Icon } from "@/components/Icon";
import type { MapPoint } from "@/components/map/LeafletMap";
import { MediaImg } from "@/components/media/Media";
import { useMediaMetas } from "@/components/media/useMedia";
import { MONTHS_NOM } from "@/lib/collect";
import { plural } from "@/lib/format";
import { routes } from "@/lib/routes";
import { fmtKm, hasCoords, isEvent, momentDate, tripDateRange, tripDays, tripKm, tripMediaIds } from "@/lib/stats";
import { allTags } from "@/lib/tags";
import { rub, tripSpent } from "@/lib/plan";
import { useTrips } from "@/lib/useTrips";
import type { Checkpoint, Trip } from "@/lib/types";
import { BackLink } from "@/components/BackLink";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap").then((m) => m.LeafletMap), { ssr: false });

/** Город из подписи места: «Кремль, Казань, Татарстан» → «Казань», «Казань, Татарстан» → «Казань». */
const cityOf = (label?: string) => {
  const p = (label ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return p.length >= 3 ? p[1] : p[0];
};

/** «Итоги года»: только реальные цифры и моменты выбранного года. */
function YearRecap() {
  const { trips: all } = useTrips();
  const router = useRouter();
  const years = useMemo(() => Array.from(new Set((all ?? []).flatMap((t) => [t.date, ...t.checkpoints.map((c) => c.meta?.date)]).filter(Boolean).map((d) => d!.slice(0, 4)))).sort().reverse(), [all]);
  const y = useSearchParams().get("y") ?? years[0] ?? String(new Date().getFullYear());

  const moments = useMemo(
    // Моменты — это точки с содержанием: обычные точки, а начало/конец пути — только если к ним что-то добавлено.
    () =>
      (all ?? []).flatMap((t) =>
        t.checkpoints.filter((c) => momentDate(t, c).startsWith(y) && (c.kind === "regular" || c.mediaIds.length > 0 || Boolean(c.description))).map((c) => ({ t, c }))
      ),
    [all, y]
  );
  // Поездка относится к году своего начала — так же, как в хронологии и статистике.
  const trips = useMemo(() => (all ?? []).filter((t) => t.date.startsWith(y)), [all, y]);
  const metas = useMediaMetas(useMemo(() => trips.flatMap(tripMediaIds), [trips]));

  const tripList = trips.filter((t) => !isEvent(t));
  const events = trips.filter(isEvent);
  const km = tripList.reduce((s, t) => s + (tripKm(t) ?? 0), 0);
  const days = tripList.reduce((s, t) => s + tripDays(t), 0);
  const photos = metas.filter((m) => m.kind === "image").length;
  const videos = metas.filter((m) => m.kind === "video").length;
  const cities = new Set(moments.map(({ c }) => cityOf(c.location?.label)).filter(Boolean));

  const byMonth = Array.from({ length: 12 }, (_, i) => moments.filter(({ t, c }) => Number(momentDate(t, c).slice(5, 7)) === i + 1).length);
  const maxMonth = Math.max(1, ...byMonth);
  const topMonth = byMonth.indexOf(Math.max(...byMonth));
  const longest = [...tripList].sort((a, b) => (tripKm(b) ?? 0) - (tripKm(a) ?? 0))[0];
  const best: { t: Trip; c: Checkpoint }[] = [...moments].filter(({ c }) => c.coverMediaId).sort((a, b) => b.c.importance - a.c.importance || b.c.mediaIds.length - a.c.mediaIds.length).slice(0, 9);
  const sorted = [...moments].sort((a, b) => (momentDate(a.t, a.c) + (a.c.time ?? "")).localeCompare(momentDate(b.t, b.c) + (b.c.time ?? "")));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const tags = allTags(trips).slice(0, 5);
  const spent = trips.reduce((s, t) => s + tripSpent(t), 0);
  const points: MapPoint[] = moments.filter(({ c }) => hasCoords(c)).map(({ t, c }) => ({ id: `${t.id}:${c.id}`, lat: c.location!.lat, lon: c.location!.lon, color: c.style.color, photoId: c.coverMediaId, icon: c.icon ?? "📍" }));

  return (
    <main className="shell yearPage">
      <header className="nmHead">
        <BackLink href={routes.me} className="iconBtnPlain">
          <Icon name="back" />
        </BackLink>
        <h1>Итоги {y}</h1>
        <span style={{ width: 40 }} />
      </header>

      {years.length > 1 && (
        <div className="yearChips static">
          {years.map((yy) => (
            <button key={yy} className={yy === y ? "on" : ""} onClick={() => router.replace(routes.year(yy))}>
              {yy}
            </button>
          ))}
        </div>
      )}

      {all === null && <p className="muted">Загрузка…</p>}
      {all && moments.length === 0 && <p className="muted">В {y} году пока нет моментов.</p>}
      {moments.length > 0 && (
        <>
          <section className="yrHero">
            <p className="muted">Ваш {y} год</p>
            <strong className="yrBig">{moments.length}</strong>
            <span>{plural(moments.length, "момент", "момента", "моментов")} в истории</span>
          </section>

          <div className="statTiles">
            {[
              { icon: "map", value: String(tripList.length), label: plural(tripList.length, "поездка", "поездки", "поездок"), color: "#2f7bff" },
              { icon: "star", value: String(events.length), label: plural(events.length, "событие", "события", "событий"), color: "#ff8a1f" },
              { icon: "route", value: fmtKm(km), label: "км в пути", color: "#16c79a" },
              { icon: "calendar", value: String(days), label: plural(days, "день в пути", "дня в пути", "дней в пути"), color: "#ffc531" },
              { icon: "photo", value: String(photos), label: "фото", color: "#b46bff" },
              { icon: "video", value: String(videos), label: "видео", color: "#ff4d5e" },
              { icon: "pin", value: String(cities.size), label: plural(cities.size, "город", "города", "городов"), color: "#14a3c7" },
              ...(spent > 0 ? [{ icon: "star", value: rub(spent), label: "потрачено в поездках", color: "#e0459b" }] : []),
            ].map((s) => (
              <div key={s.label} className="statTile" style={{ ["--tc" as string]: s.color }}>
                <Icon name={s.icon} size={22} />
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          <section className="statsBlock">
            <h2>По месяцам</h2>
            <div className="yrMonths">
              {byMonth.map((n, i) => (
                <div key={i} className={`yrMonth ${i === topMonth && n ? "top" : ""}`}>
                  <span className="yrBar">
                    <i style={{ height: `${(n / maxMonth) * 100}%` }} />
                  </span>
                  <span className="yrM">{MONTHS_NOM[i].slice(0, 3)}</span>
                </div>
              ))}
            </div>
            {byMonth[topMonth] > 0 && <p className="hint">Самый насыщенный месяц — {MONTHS_NOM[topMonth].toLowerCase()}: {byMonth[topMonth]} {plural(byMonth[topMonth], "момент", "момента", "моментов")}.</p>}
          </section>

          {best.length > 0 && (
            <section className="statsBlock">
              <h2>Лучшие моменты</h2>
              <div className="yrBest">
                {best.map(({ t, c }) => (
                  <Link key={c.id} href={routes.moment(t.id, c.id)} className="yrTile">
                    <MediaImg id={c.coverMediaId!} />
                    <span>{c.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {points.length > 0 && (
            <section className="statsBlock">
              <h2>Где вы были</h2>
              <div className="regionsMap">
                <LeafletMap points={points} labels={false} />
              </div>
            </section>
          )}

          <section className="statsBlock yrFacts">
            <Link href={routes.book({ year: y })} className="mTrip">
              <Icon name="photo" size={18} /> Фотокнига {y} года (PDF)
              <Icon name="chevron" size={16} />
            </Link>
            {first && (
              <Link href={routes.moment(first.t.id, first.c.id)} className="mTrip">
                <Icon name="calendar" size={18} /> Первый момент года: {first.c.title}
                <Icon name="chevron" size={16} />
              </Link>
            )}
            {longest && (tripKm(longest) ?? 0) > 0 && (
              <Link href={routes.trip(longest.id)} className="mTrip">
                <Icon name="route" size={18} /> Самая длинная поездка: {longest.title} · {fmtKm(tripKm(longest)!)} км
                <Icon name="chevron" size={16} />
              </Link>
            )}
            {last && last !== first && (
              <Link href={routes.moment(last.t.id, last.c.id)} className="mTrip">
                <Icon name="clock" size={18} /> Последний момент: {last.c.title}
                <Icon name="chevron" size={16} />
              </Link>
            )}
            {tags.length > 0 && (
              <div className="tagChips" style={{ marginTop: 8 }}>
                {tags.map(({ tag, count }) => (
                  <Link key={tag} className="tagChip" href={`${routes.timeline}?tag=${encodeURIComponent(tag)}`}>
                    #{tag} <em>{count}</em>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {tripList.length > 0 && (
            <section className="statsBlock">
              <h2>Поездки года</h2>
              <div className="momentList">
                {tripList.map((t) => (
                  <Link key={t.id} className="mTrip" href={routes.trip(t.id)}>
                    <Icon name="route" size={18} /> {t.title}
                    <span className="muted small" style={{ marginLeft: "auto" }}>
                      {tripDateRange(t)}
                    </span>
                    <Icon name="chevron" size={16} />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

export default function YearPage() {
  return (
    <Suspense fallback={null}>
      <YearRecap />
    </Suspense>
  );
}

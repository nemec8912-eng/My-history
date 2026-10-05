"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import type { MapArea, MapPoint } from "@/components/map/LeafletMap";
import { plural } from "@/lib/format";
import { regionShape, reverseInfo } from "@/lib/geocode";
import { routes } from "@/lib/routes";
import { fmtKm, hasCoords, isEvent, kmByMode, momentDate, tripDays, tripKm } from "@/lib/stats";
import { TRAVEL } from "@/lib/travel";
import { rub, tripSpent } from "@/lib/plan";
import { useTrips } from "@/lib/useTrips";
import type { TravelMode, Trip } from "@/lib/types";
import { BackLink } from "@/components/BackLink";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap").then((m) => m.LeafletMap), { ssr: false });
const REGION_COLOR = "#2f7bff";

type Visit = { region: string; country?: string; first: string; count: number; tripIds: Set<string> };

/** Километры, регионы и страны — только по реальным точкам поездок и событий. */
export default function StatsPage() {
  const { trips: all } = useTrips();
  const [year, setYear] = useState("all");
  const [regionOf, setRegionOf] = useState<Record<string, { state?: string; country?: string } | null>>({});
  const [shapes, setShapes] = useState<Record<string, object | null>>({});

  const years = useMemo(() => Array.from(new Set((all ?? []).map((t) => t.date.slice(0, 4)))).sort().reverse(), [all]);
  const trips = useMemo(() => (all ?? []).filter((t) => year === "all" || t.date.startsWith(year)), [all, year]);
  const located = useMemo(
    () => trips.flatMap((t) => t.checkpoints.filter(hasCoords).map((c) => ({ t, c, key: `${c.location!.lat.toFixed(1)},${c.location!.lon.toFixed(1)}` }))),
    [trips]
  );

  // Регион каждой точки (по одному запросу в секунду, с кэшем на устройстве).
  useEffect(() => {
    let alive = true;
    const seen = new Set<string>();
    for (const { c, key } of located) {
      if (seen.has(key) || key in regionOf) continue;
      seen.add(key);
      reverseInfo(c.location!.lat, c.location!.lon, 5).then((info) => alive && setRegionOf((r) => ({ ...r, [key]: info ? { state: info.state, country: info.country } : null })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located]);

  const visits = useMemo(() => {
    const m = new Map<string, Visit>();
    for (const { t, c, key } of located) {
      const r = regionOf[key];
      if (!r?.state) continue;
      const v = m.get(r.state) ?? { region: r.state, country: r.country, first: momentDate(t, c), count: 0, tripIds: new Set<string>() };
      v.count++;
      v.tripIds.add(t.id);
      if (momentDate(t, c) < v.first) v.first = momentDate(t, c);
      m.set(r.state, v);
    }
    return Array.from(m.values()).sort((a, b) => b.tripIds.size - a.tripIds.size || a.region.localeCompare(b.region));
  }, [located, regionOf]);
  const ru = visits.filter((v) => !v.country || v.country === "ru");
  const abroad = visits.filter((v) => v.country && v.country !== "ru");
  const pendingRegions = located.filter((l) => !(l.key in regionOf)).length;

  useEffect(() => {
    let alive = true;
    for (const v of ru) if (!(v.region in shapes)) regionShape(v.region).then((g) => alive && setShapes((s) => ({ ...s, [v.region]: g })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ru.map((v) => v.region).join("|")]);

  const tripList = trips.filter((t) => !isEvent(t));
  const events = trips.filter(isEvent);
  const totalKm = tripList.reduce((s, t) => s + (tripKm(t) ?? 0), 0);
  const days = tripList.reduce((s, t) => s + tripDays(t), 0);
  const modes = kmByMode(trips);
  const maxMode = modes[0]?.km ?? 1;
  const longest = [...tripList].map((t) => ({ t, km: tripKm(t) ?? 0 })).filter((x) => x.km > 0).sort((a, b) => b.km - a.km).slice(0, 5);

  const areas: MapArea[] = ru.filter((v) => shapes[v.region]).map((v) => ({ id: v.region, color: REGION_COLOR, geojson: shapes[v.region]! }));
  const points: MapPoint[] = located.map(({ t, c }) => ({ id: `${t.id}:${c.id}`, lat: c.location!.lat, lon: c.location!.lon, color: c.style.color, icon: "" }));

  return (
    <main className="shell statsPage">
      <header className="nmHead">
        <BackLink href={routes.me} className="iconBtnPlain">
          <Icon name="back" />
        </BackLink>
        <h1>Статистика и регионы</h1>
        <span style={{ width: 40 }} />
      </header>

      {years.length > 0 && (
        <div className="yearChips static">
          <button className={year === "all" ? "on" : ""} onClick={() => setYear("all")}>
            Всё время
          </button>
          {years.map((y) => (
            <button key={y} className={year === y ? "on" : ""} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      )}

      {all === null && <p className="muted">Загрузка…</p>}
      {all && (
        <>
          <div className="statTiles">
            {[
              { icon: "route", value: fmtKm(totalKm), label: "км в пути", color: "#16c79a" },
              { icon: "map", value: String(tripList.length), label: plural(tripList.length, "поездка", "поездки", "поездок"), color: "#2f7bff" },
              { icon: "star", value: String(events.length), label: plural(events.length, "событие", "события", "событий"), color: "#ff8a1f" },
              { icon: "calendar", value: String(days), label: plural(days, "день в пути", "дня в пути", "дней в пути"), color: "#ffc531" },
              { icon: "pin", value: String(ru.length), label: plural(ru.length, "регион России", "региона России", "регионов России"), color: "#b46bff" },
              ...(trips.some((t) => tripSpent(t) > 0) ? [{ icon: "star", value: rub(trips.reduce((s, t) => s + tripSpent(t), 0)), label: "потрачено в поездках", color: "#e0459b" }] : []),
            ].map((s) => (
              <div key={s.label} className="statTile" style={{ ["--tc" as string]: s.color }}>
                <Icon name={s.icon} size={22} />
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          <section className="statsBlock">
            <h2>Где вы были</h2>
            <div className="regionsMap">
              <LeafletMap points={points} areas={areas} />
            </div>
            {pendingRegions > 0 && <p className="hint">Определяю регионы… осталось точек: {pendingRegions}</p>}
            {!located.length && <p className="muted small">Укажите место у моментов — регионы появятся здесь.</p>}
            <ul className="regionList">
              {ru.map((v) => (
                <li key={v.region}>
                  <span className="rgDot" />
                  <strong>{v.region}</strong>
                  <span className="muted small">
                    {v.tripIds.size} {plural(v.tripIds.size, "раз", "раза", "раз")} · впервые {v.first.split("-").reverse().join(".")}
                  </span>
                </li>
              ))}
            </ul>
            {abroad.length > 0 && (
              <>
                <h3 className="muted small">За границей</h3>
                <ul className="regionList">
                  {abroad.map((v) => (
                    <li key={v.region}>
                      <span className="rgDot abroad" />
                      <strong>{v.region}</strong>
                      <span className="muted small">{v.country?.toUpperCase()}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {modes.length > 0 && (
            <section className="statsBlock">
              <h2>Как добирались</h2>
              <div className="modeBars">
                {modes.map((m) => {
                  const t = TRAVEL[m.mode as TravelMode];
                  return (
                    <div key={m.mode} className="modeBar">
                      <span className="mbLabel">
                        {t ? `${t.icon} ${t.label}` : "Не указано"}
                      </span>
                      <span className="mbTrack">
                        <i style={{ width: `${Math.max(3, (m.km / maxMode) * 100)}%` }} />
                      </span>
                      <span className="mbValue">{fmtKm(m.km)} км</span>
                    </div>
                  );
                })}
              </div>
              <p className="hint">Расстояние считается по прямой между точками маршрута. Способ — тот, что выбран у точки («Как добрались»).</p>
            </section>
          )}

          {longest.length > 0 && (
            <section className="statsBlock">
              <h2>Самые длинные поездки</h2>
              <div className="momentList">
                {longest.map(({ t, km }) => (
                  <TripRow key={t.id} t={t} km={km} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function TripRow({ t, km }: { t: Trip; km: number }) {
  return (
    <Link className="mTrip" href={routes.trip(t.id)}>
      <Icon name="route" size={18} /> {t.title}
      <span className="muted small" style={{ marginLeft: "auto" }}>
        {fmtKm(km)} км
      </span>
      <Icon name="chevron" size={16} />
    </Link>
  );
}

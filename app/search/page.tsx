"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TabScreen } from "@/components/BottomNav";
import { Icon } from "@/components/Icon";
import { MediaImg } from "@/components/media/Media";
import { routes } from "@/lib/routes";
import { popularPlaces, searchAll } from "@/lib/search";
import { isEvent, momentDate, tripCover, tripDateRange } from "@/lib/stats";
import { formatDate } from "@/lib/format";
import { useTrips } from "@/lib/useTrips";
import { allTags } from "@/lib/tags";

function Hl({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="hl">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** Поиск (экран 9 макета). */
export default function SearchPage() {
  const { trips } = useTrips();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const res = useMemo(() => searchAll(trips ?? [], q), [trips, q]);
  const popular = useMemo(() => popularPlaces(trips ?? []), [trips]);
  const tags = useMemo(() => allTags(trips ?? []).slice(0, 20), [trips]);
  const query = q.trim();

  return (
    <TabScreen className="searchPage">
      <div className="searchWrap big">
        <span className="searchIcon" aria-hidden>
          <Icon name="search" size={20} />
        </span>
        <input ref={input} className="searchInput" type="search" placeholder="Поиск по поездкам и моментам…" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        {q && (
          <button className="searchClear" aria-label="Очистить" onClick={() => setQ("")}>
            ×
          </button>
        )}
      </div>

      {!query ? (
        <>
          {trips && trips.length > 0 && (
            <section className="homeSection">
              <h2 className="secTitle">Недавние</h2>
              <div className="hScroll">
                {trips.slice(0, 10).map((t) => (
                  <Link key={t.id} className="miniCard" href={routes.trip(t.id)}>
                    <div className="coverBg">
                      {tripCover(t) ? <MediaImg id={tripCover(t)} /> : <span className="coverEmpty">🗺</span>}
                      <i className="coverShade" />
                    </div>
                    <span>{t.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {tags.length > 0 && (
            <section className="homeSection">
              <h2 className="secTitle">Метки</h2>
              <div className="tagChips">
                {tags.map(({ tag, count }) => (
                  <button key={tag} className="tagChip" onClick={() => setQ("#" + tag)}>
                    #{tag} <em>{count}</em>
                  </button>
                ))}
              </div>
            </section>
          )}
          {popular.length > 0 && (
            <section className="homeSection">
              <h2 className="secTitle">Ваши места</h2>
              <div className="placeGrid">
                {popular.map((p) => (
                  <button key={p.name} className="placeTile" onClick={() => setQ(p.name)}>
                    <div className="coverBg">
                      {p.cp.coverMediaId ? <MediaImg id={p.cp.coverMediaId} /> : <span className="coverEmpty">📍</span>}
                      <i className="coverShade" />
                    </div>
                    <span>{p.name}</span>
                    {p.count > 1 && <em>{p.count}</em>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {trips && trips.length === 0 && <p className="muted">Пока нечего искать — добавьте первую поездку или событие.</p>}
        </>
      ) : (
        <>
          <p className="muted small">
            Найдено: {res.trips.length + res.moments.length}
          </p>
          {res.trips.length > 0 && (
            <section className="homeSection">
              <h2 className="secTitle">Поездки и события</h2>
              <div className="tripRows">
                {res.trips.map((t) => (
                  <Link key={t.id} className="tripRow" href={routes.trip(t.id)}>
                    <span className="tripRowCover">{tripCover(t) ? <MediaImg id={tripCover(t)} /> : <span>🗺</span>}</span>
                    <span className="tripRowText">
                      <strong>
                        <Hl text={t.title} q={query} />
                      </strong>
                      <span className="muted small">
                        {isEvent(t) ? "Событие" : "Поездка"} · {tripDateRange(t)}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} className="rowChevron" />
                  </Link>
                ))}
              </div>
            </section>
          )}
          {res.moments.length > 0 && (
            <section className="homeSection">
              <h2 className="secTitle">Места и моменты</h2>
              <div className="tripRows">
                {res.moments.map(({ trip, cp }) => (
                  <Link key={cp.id} className="tripRow" href={routes.moment(trip.id, cp.id)}>
                    <span className="tripRowCover" style={{ background: cp.style.color }}>
                      {cp.coverMediaId ? <MediaImg id={cp.coverMediaId} /> : <span>{cp.icon ?? "📍"}</span>}
                    </span>
                    <span className="tripRowText">
                      <strong>
                        <Hl text={cp.title} q={query} />
                      </strong>
                      <span className="muted small">
                        {formatDate(momentDate(trip, cp))} · {trip.title}
                      </span>
                      {cp.location?.label && (
                        <span className="small hitPoint">
                          <Hl text={cp.location.label} q={query} />
                        </span>
                      )}
                    </span>
                    <Icon name="chevron" size={18} className="rowChevron" />
                  </Link>
                ))}
              </div>
            </section>
          )}
          {res.trips.length + res.moments.length === 0 && <p className="muted">Ничего не найдено. Попробуйте другие буквы.</p>}
        </>
      )}
    </TabScreen>
  );
}

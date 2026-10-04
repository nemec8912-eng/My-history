"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { haversineKm } from "@/lib/format";
import { currentPosition } from "@/lib/geocode";
import { newId } from "@/lib/markerStyle";
import { wikiNearby, type NearbyPlace } from "@/lib/nearby";
import { routes } from "@/lib/routes";
import { hasCoords } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";
import { useUserData } from "@/lib/userdata";
import type { GeoPoint } from "@/lib/types";

const fmt = (km: number) => (km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(km < 10 ? 1 : 0).replace(".", ",")} км`);

/** «Интересное рядом»: достопримечательности из Википедии вокруг момента или вокруг вас. */
function Nearby() {
  const sp = useSearchParams();
  const [point, setPoint] = useState<GeoPoint | null>(sp.get("lat") ? { lat: Number(sp.get("lat")), lon: Number(sp.get("lon")) } : null);
  const [list, setList] = useState<NearbyPlace[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const { trips } = useTrips();
  const { data, update } = useUserData();

  useEffect(() => {
    if (point) return;
    currentPosition()
      .then(setPoint)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [point]);

  useEffect(() => {
    if (!point) return;
    const ctrl = new AbortController();
    setList(null);
    wikiNearby(point, 10000, ctrl.signal)
      .then(setList)
      .catch((e) => e.name !== "AbortError" && setErr(e.message));
    return () => ctrl.abort();
  }, [point]);

  const visitedPts = useMemo(() => (trips ?? []).flatMap((t) => t.checkpoints.filter(hasCoords).map((c) => c.location!)), [trips]);
  const visited = (p: NearbyPlace) => visitedPts.some((v) => haversineKm(v, p) <= 0.3);
  const wished = (p: NearbyPlace) => (data?.wishes ?? []).some((w) => w.title === p.title);
  const shown = (list ?? []).filter((p) => !onlyNew || !visited(p));

  function wish(p: NearbyPlace) {
    void update((d) => ({
      ...d,
      wishes: [...(d.wishes ?? []), { id: newId(), title: p.title, location: { lat: p.lat, lon: p.lon, label: p.title }, note: p.description, createdAt: new Date().toISOString() }],
    }));
  }

  return (
    <main className="shell nearbyPage">
      <header className="nmHead">
        <Link href={routes.map} className="iconBtnPlain" aria-label="Назад">
          <Icon name="back" />
        </Link>
        <h1>Интересное рядом</h1>
        <button className="iconBtnPlain" aria-label="Рядом со мной" onClick={() => currentPosition().then(setPoint).catch((e) => setErr(String(e?.message ?? e)))}>
          <Icon name="locate" />
        </button>
      </header>
      <p className="hint">Места из Википедии в радиусе 10 км. Отмечено, где вы уже были.</p>
      <label className="checkRow">
        <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Только где ещё не был
      </label>
      {err && <p className="errorBar">{err}</p>}
      {point && list === null && !err && <p className="muted">Ищу…</p>}
      {list?.length === 0 && <p className="muted">Рядом ничего не нашлось.</p>}
      <div className="nearList">
        {shown.map((p) => (
          <div key={p.id} className="nearItem">
            <span className="nearThumb">{p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <Icon name="pin" size={20} />}</span>
            <span className="nearText">
              <strong>{p.title}</strong>
              {p.description && <span className="muted small">{p.description}</span>}
              <span className="small">
                {fmt(p.km)}
                {visited(p) ? " · ✓ вы здесь были" : ""}
              </span>
            </span>
            <span className="nearActions">
              <a className="linkBtn" href={p.url} target="_blank" rel="noreferrer">
                Статья
              </a>
              {wished(p) ? (
                <span className="muted small">⭐ в планах</span>
              ) : (
                <button className="linkBtn" onClick={() => wish(p)}>
                  Хочу поехать
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="hint">Данные: Википедия (CC BY-SA).</p>
    </main>
  );
}

export default function NearbyPage() {
  return (
    <Suspense fallback={null}>
      <Nearby />
    </Suspense>
  );
}

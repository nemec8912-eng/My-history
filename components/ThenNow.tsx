"use client";

import Link from "next/link";
import { useMemo } from "react";
import { haversineKm } from "@/lib/format";
import { routes } from "@/lib/routes";
import { hasCoords, momentDate } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";
import type { Checkpoint, Trip } from "@/lib/types";
import { MediaImg } from "./media/Media";

const ago = (from: string, to: string) => {
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
  const y = Math.floor(Math.abs(days) / 365);
  if (y >= 1) return days > 0 ? `${y} ${y % 10 === 1 && y % 100 !== 11 ? "год" : [2, 3, 4].includes(y % 10) && ![12, 13, 14].includes(y % 100) ? "года" : "лет"} назад` : `через ${y} г.`;
  const m = Math.round(Math.abs(days) / 30);
  return days > 0 ? `${m} мес. назад` : `через ${m} мес.`;
};

/** «Тогда и сейчас»: снимки из этого же места в другие дни (в радиусе 300 м). */
export function ThenNow({ trip, cp }: { trip: Trip; cp: Checkpoint }) {
  const { trips } = useTrips();
  const date = momentDate(trip, cp);
  const hits = useMemo(() => {
    if (!hasCoords(cp)) return [];
    const out: { t: Trip; c: Checkpoint; d: string }[] = [];
    for (const t of trips ?? [])
      for (const c of t.checkpoints) {
        if (c.id === cp.id || !hasCoords(c) || !c.coverMediaId) continue;
        const d = momentDate(t, c);
        if (Math.abs(new Date(d).getTime() - new Date(date).getTime()) < 25 * 86_400_000) continue;
        if (haversineKm(c.location!, cp.location!) <= 0.3) out.push({ t, c, d });
      }
    return out.sort((a, b) => a.d.localeCompare(b.d));
  }, [trips, cp, date]);
  if (!hits.length) return null;
  return (
    <section className="thenNow">
      <h3>Тогда и сейчас</h3>
      <p className="muted small">Вы уже бывали здесь:</p>
      <div className="tnRow">
        {cp.coverMediaId && (
          <span className="tnTile now">
            <MediaImg id={cp.coverMediaId} />
            <em>Этот момент</em>
          </span>
        )}
        {hits.map(({ t, c, d }) => (
          <Link key={c.id} className="tnTile" href={routes.moment(t.id, c.id)}>
            <MediaImg id={c.coverMediaId!} />
            <em>{ago(d, date)}</em>
          </Link>
        ))}
      </div>
    </section>
  );
}

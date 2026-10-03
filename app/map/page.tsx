"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RoutePlanner } from "@/components/map/RoutePlanner";
import { TripMap } from "@/components/map/TripMap";
import { createCheckpoint } from "@/lib/markerStyle";
import { getRepo, newTrip } from "@/lib/repo";
import type { Trip } from "@/lib/types";

/** Быстрый маршрут без поездки. Можно сохранить его как новую поездку. */
export default function MapPage() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip>(() =>
    newTrip({
      id: "draft-route",
      title: "Новый маршрут",
      checkpoints: [createCheckpoint("start", { title: "Откуда" }), createCheckpoint("end", { title: "Куда" })],
    })
  );
  const [saving, setSaving] = useState(false);

  async function saveAsTrip() {
    setSaving(true);
    const title = trip.route?.to.label?.split(",")[0] || "Новая поездка";
    const t = newTrip({
      title,
      route: trip.route,
      checkpoints: trip.checkpoints.map((c) =>
        c.kind === "start"
          ? { ...c, title: c.location?.label?.split(",")[0] || "Начало пути" }
          : c.kind === "end"
            ? { ...c, title: c.location?.label?.split(",")[0] || title }
            : c
      ),
    });
    try {
      await (await getRepo()).save(t);
      router.push(`/trip/${t.id}`);
    } catch (e) {
      alert("Не удалось сохранить: " + (e instanceof Error ? e.message : String(e)));
      setSaving(false);
    }
  }

  return (
    <main className="tripPage">
      <header className="tripTop">
        <Link className="roundBtn" href="/" aria-label="Назад">←</Link>
        <div className="tripTitle">
          <h1>Маршрут</h1>
          <p className="muted">Карта и маршруты 2ГИС</p>
        </div>
      </header>
      <section className="mapSection">
        <RoutePlanner trip={trip} onChange={setTrip} />
        <TripMap trip={trip} />
        {trip.route && (
          <button className="primary wide" onClick={saveAsTrip} disabled={saving}>
            Сохранить как поездку
          </button>
        )}
      </section>
    </main>
  );
}

"use client";

/* Тонкий адаптер к 2ГИС MapGL. Данные поездки в него только передаются — сама модель от 2ГИС не зависит. */
import { useEffect, useRef, useState } from "react";
import { SHAPES, SIZES, safeColor } from "@/lib/markerStyle";
import type { Checkpoint, Trip } from "@/lib/types";

type AnyMap = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function markerHtml(cp: Checkpoint, index: number): string {
  const d = Math.round(Math.max(30, SIZES[cp.style.size].px * 0.9));
  const color = safeColor(cp.style.color);
  const label = cp.icon ?? (cp.kind === "start" ? "⌂" : cp.kind === "end" ? "★" : String(index + 1));
  const shape = (SHAPES[cp.style.shape] ?? SHAPES.circle).svg;
  const title = cp.kind !== "regular" || cp.style.showLabel ? `<span class="mapLabel">${escapeHtml(cp.title)}</span>` : "";
  return `<div class="mapMarker" data-id="${escapeHtml(cp.id)}" style="width:${d}px;height:${d}px;transform:translate(-50%,-50%)">
    <svg viewBox="0 0 100 100" width="${d}" height="${d}"><g fill="${color}" stroke="#fff" stroke-width="8">${shape}</g></svg>
    <span class="mapMarkerText" style="font-size:${Math.round(d * 0.42)}px">${escapeHtml(label)}</span>${title}</div>`;
}

export function TripMap({
  trip,
  onMarkerClick,
  onMapClick,
  picking,
}: {
  trip: Trip;
  onMarkerClick?: (id: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  picking?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ mapgl: AnyMap; map: AnyMap } | null>(null);
  const objects = useRef<AnyMap[]>([]);
  const fitted = useRef("");
  const handlers = useRef({ onMarkerClick, onMapClick });
  handlers.current = { onMarkerClick, onMapClick };
  const [status, setStatus] = useState<"loading" | "ready" | "nokey" | "error">("loading");
  const key = process.env.NEXT_PUBLIC_2GIS_MAP_KEY;

  useEffect(() => {
    if (!key) {
      setStatus("nokey");
      return;
    }
    let map: AnyMap;
    let cancelled = false;
    import("@2gis/mapgl")
      .then(({ load }) => load())
      .then((mapgl: AnyMap) => {
        if (cancelled || !el.current) return;
        map = new mapgl.Map(el.current, { center: [37.6176, 55.7558], zoom: 10, key, zoomControl: "centerRight" });
        map.on("click", (e: AnyMap) => {
          const [lon, lat] = e.lngLat;
          handlers.current.onMapClick?.(lat, lon);
        });
        api.current = { mapgl, map };
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
    return () => {
      cancelled = true;
      objects.current = [];
      api.current = null;
      map?.destroy();
    };
  }, [key]);

  // Перерисовка маркеров и линии маршрута при изменении поездки.
  useEffect(() => {
    if (status !== "ready" || !api.current) return;
    const { mapgl, map } = api.current;
    objects.current.forEach((o) => o.destroy());
    objects.current = [];

    const located = trip.checkpoints
      .map((cp, i) => ({ cp, i }))
      .filter(({ cp }) => cp.location && (cp.location.lat || cp.location.lon));

    if (trip.route?.segments.length) {
      for (const seg of trip.route.segments) {
        for (const line of seg.path) {
          if (line.length < 2) continue;
          const walk = seg.kind === "walk" || seg.kind === "transfer";
          objects.current.push(
            new mapgl.Polyline(map, {
              coordinates: line,
              width: walk ? 4 : 6,
              color: seg.lineColor || (walk ? "#8a8f9c" : "#633cff"),
              ...(walk ? { dashLength: 6, gapLength: 6 } : {}),
              width2: walk ? 0 : 10,
              color2: "#ffffff",
            })
          );
        }
      }
    } else if (located.length > 1) {
      objects.current.push(
        new mapgl.Polyline(map, {
          coordinates: located.map(({ cp }) => [cp.location!.lon, cp.location!.lat]),
          width: 4,
          color: "#633cff",
          dashLength: 10,
          gapLength: 8,
        })
      );
    }

    for (const { cp, i } of located) {
      const marker = new mapgl.HtmlMarker(map, {
        coordinates: [cp.location!.lon, cp.location!.lat],
        html: markerHtml(cp, i),
        zIndex: cp.kind === "regular" ? 1 : 2,
      });
      const node = marker.getContent?.() as HTMLElement | undefined;
      node?.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.current.onMarkerClick?.(cp.id);
      });
      objects.current.push(marker);
    }

    const sig = `${trip.route?.builtAt ?? ""}:${located.length}`;
    if (fitted.current !== sig) {
      const coords: [number, number][] = [
        ...located.map(({ cp }) => [cp.location!.lon, cp.location!.lat] as [number, number]),
        ...(trip.route?.segments.flatMap((s) => s.path.flat()) ?? []),
      ];
      if (coords.length === 1) map.setCenter(coords[0]);
      if (coords.length > 1) {
        const lons = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        map.fitBounds(
          { southWest: [Math.min(...lons), Math.min(...lats)], northEast: [Math.max(...lons), Math.max(...lats)] },
          { padding: { top: 70, bottom: 70, left: 50, right: 50 } }
        );
      }
      if (coords.length) fitted.current = sig;
    }
  }, [trip, status]);

  return (
    <div className={`tripMap ${picking ? "picking" : ""}`}>
      <div ref={el} className="tripMapCanvas" />
      {status !== "ready" && (
        <div className="mapOverlay">
          {status === "loading" && <p>Загружаю карту 2ГИС…</p>}
          {status === "error" && <p>Не удалось загрузить карту. Проверьте интернет.</p>}
          {status === "nokey" && (
            <p>
              Карта ещё не подключена: в Vercel нужно добавить переменную <code>NEXT_PUBLIC_2GIS_MAP_KEY</code>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

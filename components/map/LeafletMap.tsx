"use client";

/* Карта на OpenStreetMap (тёмная подложка CARTO): без ключей, работает из браузера. */
import { useEffect, useRef } from "react";
import { getMediaUrl } from "@/lib/media/store";
import { safeColor } from "@/lib/markerStyle";

export type MapPoint = { id: string; lat: number; lon: number; color: string; photoId?: string; label?: string; icon?: string; big?: boolean };
export type MapLine = { id: string; color: string; coords: [number, number][] };

/* eslint-disable @typescript-eslint/no-explicit-any */
type L = any;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function iconHtml(p: MapPoint, url?: string | null) {
  const size = p.big ? 52 : 40;
  const inner = url ? `<img src="${url}" alt="">` : `<b>${esc(p.icon ?? "")}</b>`;
  return `<div class="lmPin" style="--c:${safeColor(p.color)};width:${size}px;height:${size}px">${inner}</div>`;
}

export function LeafletMap({
  points,
  lines = [],
  onSelect,
  labels = true,
  interactive = true,
  className,
}: {
  points: MapPoint[];
  lines?: MapLine[];
  onSelect?: (id: string) => void;
  labels?: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ L: L; map: L; layer: L } | null>(null);
  const onSel = useRef(onSelect);
  onSel.current = onSelect;
  const key = JSON.stringify([points.map((p) => [p.id, p.lat, p.lon, p.photoId, p.color, p.label]), lines.map((l) => [l.id, l.coords.length, l.color])]);

  useEffect(() => {
    let cancelled = false;
    let map: L;
    import("leaflet").then((mod) => {
      const L = (mod as any).default ?? mod;
      if (cancelled || !el.current) return;
      map = L.map(el.current, {
        zoomControl: false,
        attributionControl: true,
        dragging: interactive,
        scrollWheelZoom: interactive,
        touchZoom: interactive,
        doubleClickZoom: interactive,
        boxZoom: false,
        keyboard: false,
      }).setView([55.75, 37.62], 5);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      api.current = { L, map, layer };
      draw();
    });
    return () => {
      cancelled = true;
      api.current = null;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  function draw() {
    const a = api.current;
    if (!a) return;
    const { L, map, layer } = a;
    layer.clearLayers();
    for (const ln of lines) {
      if (ln.coords.length < 2) continue;
      L.polyline(ln.coords, { color: ln.color, weight: 9, opacity: 0.18, lineCap: "round" }).addTo(layer);
      L.polyline(ln.coords, { color: ln.color, weight: 3.5, opacity: 0.95, dashArray: "1 9", lineCap: "round" }).addTo(layer);
      L.polyline(ln.coords, { color: ln.color, weight: 2, opacity: 0.55 }).addTo(layer);
    }
    const bounds: [number, number][] = [];
    for (const p of points) {
      const size = p.big ? 52 : 40;
      const marker = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: "lmIcon", html: iconHtml(p), iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        keyboard: false,
      }).addTo(layer);
      if (labels && p.label) marker.bindTooltip(esc(p.label), { permanent: true, direction: "right", offset: [size / 2 - 4, 0], className: "lmLabel" });
      marker.on("click", () => onSel.current?.(p.id));
      if (p.photoId) {
        getMediaUrl(p.photoId, "thumb").then((url) => {
          if (url) marker.setIcon(L.divIcon({ className: "lmIcon", html: iconHtml(p, url), iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
        });
      }
      bounds.push([p.lat, p.lon]);
    }
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={el} className={`leafletMap ${className ?? ""}`} />;
}

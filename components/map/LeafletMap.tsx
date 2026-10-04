"use client";

/* Карта на OpenStreetMap (тёмная подложка CARTO): без ключей, работает из браузера. */
import { useEffect, useRef } from "react";
import { getMediaUrl } from "@/lib/media/store";
import { safeColor } from "@/lib/markerStyle";

export type MapPoint = { id: string; lat: number; lon: number; color: string; photoId?: string; label?: string; icon?: string; big?: boolean };
export type MapLine = { id: string; color: string; coords: [number, number][] };
/** Закрашенная область (например, посещённый регион) в формате GeoJSON. */
export type MapArea = { id: string; color: string; geojson: object };

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

/** Подложки без ключей: OpenStreetMap (затемняется стилями) и спутник Esri с подписями. */
function addBase(L: L, map: L, base: "map" | "satellite"): L[] {
  if (base === "satellite") {
    return [
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        className: "tilesSat",
        attribution: "Tiles &copy; Esri",
      }).addTo(map),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        className: "tilesLabels",
      }).addTo(map),
    ];
  }
  return [
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "tilesDark",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map),
  ];
}

export function LeafletMap({
  points,
  lines = [],
  areas = [],
  heat = [],
  onSelect,
  labels = true,
  interactive = true,
  className,
  base = "map",
}: {
  points: MapPoint[];
  lines?: MapLine[];
  onSelect?: (id: string) => void;
  labels?: boolean;
  interactive?: boolean;
  areas?: MapArea[];
  /** Тепловая карта: точки, где вы бывали (чем гуще, тем ярче). */
  heat?: [number, number][];
  className?: string;
  base?: "map" | "satellite";
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ L: L; map: L; layer: L; tiles: L[] } | null>(null);
  const baseRef = useRef(base);
  const onSel = useRef(onSelect);
  onSel.current = onSelect;
  const key = JSON.stringify([points.map((p) => [p.id, p.lat, p.lon, p.photoId, p.color, p.label]), lines.map((l) => [l.id, l.coords.length, l.color]), areas.map((a) => a.id), heat.length, heat[0], heat[heat.length - 1]]);

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
      const tiles = addBase(L, map, baseRef.current);
      const layer = L.layerGroup().addTo(map);
      api.current = { L, map, layer, tiles };
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
    for (const ar of areas) {
      try {
        L.geoJSON(ar.geojson, { style: { color: ar.color, weight: 1.5, opacity: 0.9, fillColor: ar.color, fillOpacity: 0.4 }, interactive: false }).addTo(layer);
      } catch {
        /* повреждённая геометрия — просто не рисуем */
      }
    }
    const heatBounds: [number, number][] = [];
    for (const h of heat) {
      L.circleMarker(h, { radius: 26, stroke: false, fillColor: "#ff6a2b", fillOpacity: 0.16, interactive: false }).addTo(layer);
      L.circleMarker(h, { radius: 9, stroke: false, fillColor: "#ffc531", fillOpacity: 0.35, interactive: false }).addTo(layer);
      heatBounds.push(h);
    }
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
    bounds.push(...heatBounds);
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }

  useEffect(() => {
    baseRef.current = base;
    const a = api.current;
    if (!a) return;
    a.tiles.forEach((t: L) => t.remove());
    a.tiles = addBase(a.L, a.map, base);
  }, [base]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={el} className={`leafletMap ${className ?? ""}`} />;
}

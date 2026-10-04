"use client";

/* Выбор точки на карте: касание по карте или перетаскивание метки. Координаты можно поправить вручную. */
import { useEffect, useRef, useState } from "react";
import { reverseGeocode } from "@/lib/geocode";
import type { Location } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type L = any;

const has = (v?: Location) => Boolean(v && (v.lat || v.lon));

export function MapPointPicker({
  value,
  onChange,
  onAddress,
}: {
  value?: Location;
  onChange: (loc: Location) => void;
  /** Адрес по выбранной точке (обратное геокодирование). */
  onAddress?: (address: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ L: L; map: L; marker: L | null } | null>(null);
  const cb = useRef({ onChange, onAddress, value });
  cb.current = { onChange, onAddress, value };
  const [lat, setLat] = useState(has(value) ? String(value!.lat.toFixed(6)) : "");
  const [lon, setLon] = useState(has(value) ? String(value!.lon.toFixed(6)) : "");
  const [busy, setBusy] = useState(false);

  async function pick(la: number, lo: number, lookup = true) {
    setLat(la.toFixed(6));
    setLon(lo.toFixed(6));
    placeMarker(la, lo);
    cb.current.onChange({ lat: la, lon: lo, label: cb.current.value?.label });
    if (lookup && cb.current.onAddress) {
      setBusy(true);
      const addr = await reverseGeocode(la, lo);
      setBusy(false);
      if (addr) cb.current.onAddress(addr);
    }
  }

  function placeMarker(la: number, lo: number) {
    const a = api.current;
    if (!a) return;
    if (a.marker) a.marker.setLatLng([la, lo]);
    else {
      a.marker = a.L.marker([la, lo], {
        draggable: true,
        icon: a.L.divIcon({ className: "lmIcon", html: '<div class="lmPin pick"><b>📍</b></div>', iconSize: [40, 40], iconAnchor: [20, 38] }),
      }).addTo(a.map);
      a.marker.on("dragend", () => {
        const p = a.marker.getLatLng();
        void pick(p.lat, p.lng);
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    let map: L;
    import("leaflet").then((mod) => {
      const L = (mod as any).default ?? mod;
      if (cancelled || !el.current) return;
      const v = cb.current.value;
      map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(has(v) ? [v!.lat, v!.lon] : [55.75, 37.62], has(v) ? 14 : 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      api.current = { L, map, marker: null };
      if (has(v)) placeMarker(v!.lat, v!.lon);
      map.on("click", (e: any) => void pick(e.latlng.lat, e.latlng.lng));
      setTimeout(() => map.invalidateSize(), 250);
    });
    return () => {
      cancelled = true;
      api.current = null;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Место выбрали поиском — переносим метку и карту туда.
  useEffect(() => {
    if (!has(value) || !api.current) return;
    const cur = api.current.marker?.getLatLng();
    if (cur && Math.abs(cur.lat - value!.lat) < 1e-7 && Math.abs(cur.lng - value!.lon) < 1e-7) return;
    setLat(value!.lat.toFixed(6));
    setLon(value!.lon.toFixed(6));
    placeMarker(value!.lat, value!.lon);
    api.current.map.setView([value!.lat, value!.lon], Math.max(api.current.map.getZoom(), 13));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lon]);

  function applyManual() {
    const la = Number(lat.replace(",", "."));
    const lo = Number(lon.replace(",", "."));
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return alert("Проверьте координаты");
    void pick(la, lo);
    api.current?.map.setView([la, lo], Math.max(api.current.map.getZoom(), 13));
  }

  return (
    <div className="mapPicker">
      <div ref={el} className="mapPickerCanvas" />
      <p className="hint">Коснитесь карты или перетащите метку, чтобы уточнить точку.{busy ? " Определяю адрес…" : ""}</p>
      <div className="row three">
        <input inputMode="decimal" aria-label="Широта" placeholder="Широта" value={lat} onChange={(e) => setLat(e.target.value)} />
        <input inputMode="decimal" aria-label="Долгота" placeholder="Долгота" value={lon} onChange={(e) => setLon(e.target.value)} />
        <button type="button" className="softBtn" onClick={applyManual}>
          OK
        </button>
      </div>
    </div>
  );
}

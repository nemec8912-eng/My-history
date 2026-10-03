"use client";

import { useEffect, useRef, useState } from "react";
import { fetchRoute, fetchSuggestions } from "@/lib/geo/client";
import type { PlaceSuggestion } from "@/lib/geo/types";
import { formatDistance, formatDuration } from "@/lib/format";
import { createCheckpoint } from "@/lib/markerStyle";
import type { Checkpoint, Location, RouteData, RouteSegment, TransportMode, Trip } from "@/lib/types";

const MODES: { id: TransportMode; label: string; icon: string }[] = [
  { id: "public", label: "Транспорт", icon: "🚇" },
  { id: "pedestrian", label: "Пешком", icon: "🚶" },
  { id: "car", label: "Машина", icon: "🚗" },
  { id: "taxi", label: "Такси", icon: "🚕" },
];

const SEG_ICON: Record<string, string> = {
  Метро: "🚇", Электричка: "🚆", Автобус: "🚌", Трамвай: "🚋", Троллейбус: "🚎", Маршрутка: "🚐",
  МЦК: "🚈", МЦД: "🚆", Аэроэкспресс: "🚄", Такси: "🚕", Автомобиль: "🚗", Пешком: "🚶", Пересадка: "🔁",
};

export function segmentIcon(s: RouteSegment): string {
  return SEG_ICON[s.transport ?? ""] ?? (s.kind === "walk" ? "🚶" : s.kind === "drive" ? "🚗" : s.kind === "transfer" ? "🔁" : "🚌");
}

function AddressInput({
  label,
  value,
  near,
  onPick,
  allowMyLocation,
}: {
  label: string;
  value?: Location;
  near?: Location;
  onPick: (loc: Location | undefined) => void;
  allowMyLocation?: boolean;
}) {
  const [text, setText] = useState(value?.label ?? "");
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) setText(value?.label ?? (value ? `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}` : ""));
  }, [value]);

  useEffect(() => {
    if (!typed.current || text.trim().length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetchSuggestions(text.trim(), near, ctrl.signal)
        .then((r) => {
          setItems(r);
          setErr(null);
          setOpen(true);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setErr(e.message);
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, near]);

  function myLocation() {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        typed.current = false;
        onPick({ lat: p.coords.latitude, lon: p.coords.longitude, label: "Моё местоположение" });
        setOpen(false);
      },
      () => alert("Не удалось определить местоположение"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  return (
    <div className="addrField">
      <label>
        {label}
        <input
          value={text}
          placeholder="Адрес, станция или место"
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
          }}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      {value && !typed.current && <span className="addrOk">✓</span>}
      {open && (items.length > 0 || allowMyLocation) && (
        <ul className="suggestList">
          {allowMyLocation && (
            <li>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={myLocation}>
                <strong>📍 Моё местоположение</strong>
              </button>
            </li>
          )}
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  typed.current = false;
                  setText(it.label ?? it.name);
                  setOpen(false);
                  onPick({ lat: it.lat, lon: it.lon, label: it.label ?? it.name });
                }}
              >
                <strong>{it.name}</strong>
                {it.subtitle && <span>{it.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="fieldErr">{err}</p>}
    </div>
  );
}

export function RouteSummary({ route }: { route: RouteData }) {
  const chain = route.segments.filter((s) => s.kind !== "transfer" && (s.kind !== "walk" || (s.distance ?? 0) > 60));
  return (
    <div className="routeSummary">
      <div className="routeTotals">
        <span>⏱ <strong>{formatDuration(route.duration / 60)}</strong></span>
        <span>📏 <strong>{formatDistance(route.distance)}</strong></span>
        {route.transfers != null && <span>🔁 <strong>{route.transfers}</strong> пересадок</span>}
      </div>
      <div className="routeChain">
        {chain.map((s, i) => (
          <span key={i} className="chainItem">
            {i > 0 && <span className="chainArrow">›</span>}
            <span className="chainIcon" style={s.lineColor ? { background: s.lineColor, color: "#fff" } : undefined} title={s.transport}>
              {segmentIcon(s)}
            </span>
          </span>
        ))}
      </div>
      {route.mode === "public" && (
        <ol className="routeSteps">
          {route.segments
            .filter((s) => s.kind === "transit")
            .map((s, i) => (
              <li key={i}>
                <span className="stepIcon" style={{ background: s.lineColor || "#633cff" }}>{segmentIcon(s)}</span>
                <span>
                  <strong>{s.transport}{s.lines?.length ? ` · ${s.lines.join(", ")}` : ""}</strong>
                  <span className="muted small">
                    {[s.from, s.to].filter(Boolean).join(" → ")}
                    {s.stops && s.stops.length > 2 ? ` · ${s.stops.length - 1} ост.` : ""}
                    {s.duration ? ` · ${formatDuration(s.duration / 60)}` : ""}
                  </span>
                </span>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

/** Построение маршрута поездки: откуда / куда / способ передвижения. */
export function RoutePlanner({ trip, onChange }: { trip: Trip; onChange: (t: Trip) => void }) {
  const start = trip.checkpoints.find((c) => c.kind === "start");
  const end = trip.checkpoints.find((c) => c.kind === "end");
  const hasLoc = (l?: Location) => !!l && (l.lat !== 0 || l.lon !== 0);
  const [from, setFrom] = useState<Location | undefined>(hasLoc(start?.location) ? start!.location : trip.route?.from);
  const [to, setTo] = useState<Location | undefined>(hasLoc(end?.location) ? end!.location : trip.route?.to);
  const [mode, setMode] = useState<TransportMode>(trip.route?.mode ?? "public");
  const [viaPoints, setViaPoints] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const via = trip.checkpoints.filter((c) => c.kind === "regular" && hasLoc(c.location)).map((c) => c.location!);

  async function build() {
    if (!from || !to) return setErr("Выберите «Откуда» и «Куда» из подсказок");
    setBusy(true);
    setErr(null);
    try {
      const route = await fetchRoute({ from, to, mode, via: viaPoints && mode !== "public" ? via : undefined });
      const checkpoints = trip.checkpoints.map((c) =>
        c.kind === "start" ? { ...c, location: from } : c.kind === "end" ? { ...c, location: to } : c
      );
      onChange({ ...trip, route, checkpoints });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Добавляет посадки на транспорт как контрольные точки (если таких ещё нет). */
  function addStopsAsPoints() {
    if (!trip.route) return;
    const existing = new Set(trip.checkpoints.map((c) => c.title));
    const fresh: Checkpoint[] = [];
    for (const s of trip.route.segments) {
      if (s.kind !== "transit") continue;
      const title = `${s.transport}${s.from ? ` · ${s.from}` : ""}`;
      if (existing.has(title)) continue;
      const first = s.path[0]?.[0];
      fresh.push(
        createCheckpoint("regular", {
          title,
          icon: segmentIcon(s),
          description: [s.lines?.join(", "), s.to ? `до «${s.to}»` : ""].filter(Boolean).join(" ") || undefined,
          location: first ? { lon: first[0], lat: first[1], label: s.from } : undefined,
          style: { shape: "circle", color: s.lineColor && /^#/.test(s.lineColor) ? s.lineColor : "#2f6bff", size: "m", showLabel: false, showPhoto: true },
        })
      );
    }
    if (!fresh.length) return alert("Новых пересадок для добавления нет");
    const next = [...trip.checkpoints];
    const endIdx = next.findIndex((c) => c.kind === "end");
    next.splice(endIdx >= 0 ? endIdx : next.length, 0, ...fresh);
    onChange({ ...trip, checkpoints: next });
  }

  return (
    <div className="routePlanner">
      <div className="routeFields">
        <AddressInput label="Откуда" value={from} near={to} onPick={setFrom} allowMyLocation />
        <AddressInput label="Куда" value={to} near={from} onPick={setTo} />
      </div>
      <div className="modeRow" role="radiogroup" aria-label="Способ передвижения">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`modeBtn ${mode === m.id ? "on" : ""}`} onClick={() => setMode(m.id)}>
            <span>{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>
      {mode !== "public" && via.length > 0 && (
        <label className="toggle">
          <input type="checkbox" checked={viaPoints} onChange={(e) => setViaPoints(e.target.checked)} />
          Через мои точки ({via.length})
        </label>
      )}
      <button type="button" className="primary wide" onClick={build} disabled={busy}>
        {busy ? "Строю маршрут…" : trip.route ? "Перестроить маршрут" : "Построить маршрут"}
      </button>
      {err && <p className="errorBar">{err}</p>}
      {trip.route && (
        <>
          <RouteSummary route={trip.route} />
          <div className="editorActions">
            {trip.route.mode === "public" && (
              <button type="button" className="softBtn" onClick={addStopsAsPoints}>+ Пересадки как точки</button>
            )}
            <button type="button" className="softBtn" onClick={() => confirm("Убрать маршрут? Точки останутся.") && onChange({ ...trip, route: undefined })}>
              Убрать маршрут
            </button>
          </div>
        </>
      )}
    </div>
  );
}

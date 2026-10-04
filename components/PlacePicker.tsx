"use client";

import { useEffect, useRef, useState } from "react";
import { currentPosition, reverseGeocode, searchPlaces, type PlaceHit } from "@/lib/geocode";
import type { Location } from "@/lib/types";
import { Icon } from "./Icon";

/** Выбор места: поиск по России (OpenStreetMap) или «Я здесь». Название можно поправить вручную. */
export function PlacePicker({ value, onChange, autoFocus }: { value?: Location; onChange: (loc: Location | undefined) => void; autoFocus?: boolean }) {
  const [text, setText] = useState(value?.label ?? "");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) setText(value?.label ?? "");
  }, [value?.label]);

  useEffect(() => {
    const q = text.trim();
    if (!typed.current || q.length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(q, ctrl.signal)
        .then((r) => {
          setHits(r);
          setOpen(true);
          setErr(null);
        })
        .catch((e) => e.name !== "AbortError" && setErr("Поиск мест сейчас недоступен — можно просто написать название"));
    }, 650);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text]);

  async function here() {
    setBusy(true);
    setErr(null);
    try {
      const p = await currentPosition();
      const label = (await reverseGeocode(p.lat, p.lon)) ?? "Моё местоположение";
      typed.current = false;
      setText(label);
      onChange({ lat: p.lat, lon: p.lon, label });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const hasCoords = Boolean(value && (value.lat || value.lon));
  return (
    <div className="placePicker">
      <div className="ppRow">
        <Icon name="pin" size={19} />
        <input
          value={text}
          autoFocus={autoFocus}
          placeholder="Город, улица, парк, станция…"
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            // Название без координат тоже сохраняем: карта покажет место, когда оно будет выбрано из подсказок.
            onChange(e.target.value ? { lat: 0, lon: 0, label: e.target.value } : undefined);
          }}
          onFocus={() => hits.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="button" className="ppHere" onClick={here} disabled={busy} aria-label="Я здесь">
          <Icon name="locate" size={18} /> {busy ? "…" : "Я здесь"}
        </button>
      </div>
      {hasCoords && <span className="ppOk">✓ на карте</span>}
      {open && hits.length > 0 && (
        <ul className="suggestList">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  typed.current = false;
                  setText(h.label);
                  setOpen(false);
                  onChange({ lat: h.lat, lon: h.lon, label: h.label });
                }}
              >
                <strong>{h.short}</strong>
                {h.label !== h.short && <span>{h.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="fieldErr">{err}</p>}
    </div>
  );
}

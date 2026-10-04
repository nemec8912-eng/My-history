"use client";

import { useEffect, useRef, useState } from "react";
import { searchAddress, type AddressHit } from "@/lib/geocode";

/**
 * Поле «Адрес» с подсказками: улица и дом из OpenStreetMap, сначала рядом с точкой момента.
 * Выбор подсказки заполняет адрес и (по желанию) переносит точку на карте на этот адрес.
 */
export function AddressInput({
  value,
  near,
  onChange,
  onPick,
}: {
  value: string;
  near?: { lat: number; lon: number };
  onChange: (v: string) => void;
  onPick: (hit: AddressHit) => void;
}) {
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const typed = useRef(false);

  useEffect(() => {
    const q = value.trim();
    if (!typed.current || q.length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchAddress(q, near, ctrl.signal)
        .then((r) => {
          setHits(r);
          setOpen(true);
          setErr(null);
        })
        .catch((e) => e.name !== "AbortError" && setErr("Подсказки адреса сейчас недоступны — можно просто написать адрес"));
    }, 550);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="placePicker addressInput">
      <input
        value={value}
        placeholder="Улица, дом (необязательно)"
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        autoComplete="off"
        enterKeyHint="search"
      />
      {open && hits.length > 0 && (
        <ul className="suggestList">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  typed.current = false;
                  setOpen(false);
                  setHits([]);
                  onPick(h);
                }}
              >
                <strong>{h.address}</strong>
                {h.detail && <span>{h.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="fieldErr">{err}</p>}
    </div>
  );
}

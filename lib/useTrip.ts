"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeOrder } from "./markerStyle";
import { getRepo } from "./repo";
import type { Trip } from "./types";

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function useTrip(id: string | undefined) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Самая свежая версия поездки — чтобы долгие операции (загрузка фото, погода) не затирали новые правки. */
  const latest = useRef<Trip | null>(null);

  useEffect(() => {
    if (!id) {
      setStatus("missing");
      return;
    }
    let alive = true;
    setStatus("loading");
    getRepo()
      .then((repo) => repo.get(id))
      .then((t) => {
        if (!alive) return;
        latest.current = t;
        setTrip(t);
        setStatus(t ? "ready" : "missing");
      })
      .catch((e) => {
        if (!alive) return;
        setError(errorText(e));
        setStatus("missing");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  /**
   * Сохранить поездку. Можно передать функцию: она получит самую свежую версию —
   * так правка, сделанная пока грузились фото, не потеряется.
   */
  const update = useCallback((next: Trip | ((cur: Trip) => Trip)) => {
    const base = typeof next === "function" ? (latest.current ? next(latest.current) : null) : next;
    if (!base) return queue.current;
    const t: Trip = { ...base, checkpoints: normalizeOrder(base.checkpoints), updatedAt: new Date().toISOString() };
    latest.current = t;
    setTrip(t);
    setSaving(true);
    // Сохранения выполняются строго по очереди, чтобы не перезаписать новое старым.
    queue.current = queue.current
      .then(async () => {
        await (await getRepo()).save(t);
        setError(null);
      })
      .catch((e) => setError("Не удалось сохранить: " + errorText(e)))
      .finally(() => setSaving(false));
    return queue.current;
  }, []);

  const remove = useCallback(async () => {
    if (!id) return;
    await (await getRepo()).remove(id);
  }, [id]);

  return { trip, status, error, saving, update, remove };
}

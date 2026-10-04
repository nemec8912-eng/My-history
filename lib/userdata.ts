/**
 * Данные вне поездок — альбомы, «Хочу поехать», свои шаблоны сборов.
 * Хранятся в одной служебной записи (meta.kind = "system"), поэтому синхронизируются,
 * работают без сети и попадают в архив так же, как поездки. В списках эта запись не видна.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { getRepo, newTrip } from "./repo";
import type { Trip, UserData } from "./types";

const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();

export async function loadUserData(): Promise<UserData> {
  const rec = await (await getRepo()).system().catch(() => null);
  return rec?.meta?.userData ?? {};
}

/** Изменяет данные по очереди (чтобы два быстрых изменения не перезаписали друг друга). */
export function updateUserData(fn: (d: UserData) => UserData): Promise<UserData> {
  const run = queue.then(async () => {
    const repo = await getRepo();
    const rec: Trip =
      (await repo.system().catch(() => null)) ??
      newTrip({ title: "Служебная запись «Моей истории»", date: "2000-01-01", meta: { kind: "system", userData: {} } });
    const next = fn(rec.meta?.userData ?? {});
    await repo.save({ ...rec, meta: { ...rec.meta, kind: "system", userData: next }, updatedAt: new Date().toISOString() });
    listeners.forEach((l) => l());
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

export function useUserData() {
  const [data, setData] = useState<UserData | null>(null);
  const reload = useCallback(() => {
    loadUserData().then(setData).catch(() => setData({}));
  }, []);
  useEffect(() => {
    reload();
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);
  const update = useCallback(async (fn: (d: UserData) => UserData) => {
    setData((d) => fn(d ?? {})); // сразу на экране
    await updateUserData(fn);
  }, []);
  return { data, update };
}

/**
 * Данные вне поездок — альбомы, «Хочу поехать», свои шаблоны сборов.
 * Хранятся в одной служебной записи (meta.kind = "system"), поэтому синхронизируются,
 * работают без сети и попадают в архив так же, как поездки. В списках эта запись не видна.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { getRepo, newTrip } from "./repo";
import type { UserData } from "./types";

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
    let rec = await repo.system();
    if (!rec) {
      // Записи нет. Без сети нельзя понять, нет ли её в облаке — не создаём пустую поверх настоящей.
      if (repo.mode === "cloud" && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("Нет связи. Альбомы и списки можно будет изменить, когда появится интернет.");
      }
      rec = (await repo.get(repo.systemId())) ?? newTrip({ id: repo.systemId(), title: "Служебная запись «Моей истории»", date: "2000-01-01", meta: { kind: "system", userData: {} } });
    }
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
  const update = useCallback(
    async (fn: (d: UserData) => UserData) => {
      setData((d) => fn(d ?? {})); // сразу на экране
      try {
        await updateUserData(fn);
      } catch (e) {
        reload(); // вернуть как было
        alert(e instanceof Error ? e.message : String(e));
      }
    },
    [reload]
  );
  return { data, update };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { getRepo } from "./repo";
import { getSupabase } from "./supabase";
import type { Trip } from "./types";

/** Все поездки пользователя (из облака после входа, иначе с устройства). */
export function useTrips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [cloud, setCloud] = useState(false);
  const reload = useCallback(() => {
    getRepo()
      .then((r) => {
        setCloud(r.mode === "cloud");
        return r.list();
      })
      .then(setTrips)
      .catch(() => setTrips([]));
  }, []);
  useEffect(() => {
    reload();
    const sb = getSupabase();
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") reload();
    });
    return () => data.subscription.unsubscribe();
  }, [reload]);
  return { trips, cloud, reload };
}

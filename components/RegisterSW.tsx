"use client";

import { useEffect } from "react";
import { syncPendingUploads } from "@/lib/media/store";
import { asset } from "@/lib/routes";

/** Регистрирует service worker и догружает в облако файлы, сохранённые без сети. */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(asset("/sw.js"), { scope: asset("/") }).catch(() => undefined);
    }
    void syncPendingUploads();
    const online = () => void syncPendingUploads();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  return null;
}

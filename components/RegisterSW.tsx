"use client";

import { useEffect } from "react";
import { syncPendingUploads } from "@/lib/media/store";

/** Регистрирует service worker и догружает в облако файлы, сохранённые без сети. */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    void syncPendingUploads();
    const online = () => void syncPendingUploads();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  return null;
}

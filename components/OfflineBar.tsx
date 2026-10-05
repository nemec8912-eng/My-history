"use client";

import { useEffect, useState } from "react";
import { onSyncChange, pendingUploadCount, syncPendingUploads } from "@/lib/media/store";
import { failedTrips, flushPendingTrips, onTripSyncChange, pendingTripCount, retryFailed } from "@/lib/repo";
import { plural } from "@/lib/format";
import { getUserId } from "@/lib/supabase";

/**
 * Полоска состояния сети: без интернета всё сохраняется на телефоне,
 * а когда сеть появится — изменения и файлы уходят в облако сами.
 */
export function OfflineBar() {
  const [online, setOnline] = useState(true);
  const [trips, setTrips] = useState(0);
  const [files, setFiles] = useState(0);
  const [failed, setFailed] = useState<{ id: string; title: string; error: string }[]>([]);

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      // Без входа в аккаунт всё и так хранится только на устройстве — отправлять некуда.
      getUserId()
        .then((uid) => (uid ? Promise.all([pendingTripCount(), pendingUploadCount()]) : [0, 0]))
        .then(([t, f]) => {
          setTrips(t);
          setFiles(f);
        })
        .catch(() => undefined);
      failedTrips().then(setFailed).catch(() => undefined);
    };
    const sync = () => {
      if (!navigator.onLine) return refresh();
      Promise.all([flushPendingTrips(), syncPendingUploads()]).finally(refresh);
    };
    refresh();
    sync();
    const a = onTripSyncChange(refresh);
    const b = onSyncChange(refresh);
    window.addEventListener("online", sync);
    window.addEventListener("offline", refresh);
    const timer = setInterval(() => {
      // Повторяем, пока что-то не отправлено (например, сеть есть, но сервер был недоступен).
      pendingTripCount().then((n) => n > 0 && navigator.onLine && sync());
    }, 30_000);
    return () => {
      a();
      b();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", refresh);
      clearInterval(timer);
    };
  }, []);

  const waiting = trips + files;
  if (failed.length && online)
    return (
      <button className="offlineBar failed" onClick={() => void retryFailed()} title={failed.map((f) => `${f.title}: ${f.error}`).join("\n")}>
        ⚠ Облако не приняло {failed.length} {plural(failed.length, "изменение", "изменения", "изменений")} («{failed[0].title}»): {failed[0].error}. Всё сохранено на телефоне · Повторить
      </button>
    );
  if (online && waiting === 0) return null;
  return (
    <div className={`offlineBar ${online ? "syncing" : ""}`} role="status">
      {online ? "⟳ Отправляю в облако" : "Нет сети — всё сохраняется на телефоне"}
      {waiting > 0 && (
        <span>
          {" "}
          · ждут отправки: {trips > 0 ? `${trips} ${plural(trips, "изменение", "изменения", "изменений")}` : ""}
          {trips > 0 && files > 0 ? ", " : ""}
          {files > 0 ? `${files} ${plural(files, "файл", "файла", "файлов")}` : ""}
        </span>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { captureDriveRedirect } from "@/lib/media/gdrive";
import { syncPendingUploads } from "@/lib/media/store";
import { asset } from "@/lib/routes";

/** Сюда Google возвращает после выдачи доступа к Диску (вход переходом, для PWA на iPhone). */
export default function DriveReturn() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const r = captureDriveRedirect();
    if (r?.error) {
      setError(r.error);
      return;
    }
    void syncPendingUploads();
    const target = r?.returnTo && r.returnTo.startsWith(asset("/")) ? r.returnTo : asset("/");
    window.location.replace(target);
  }, []);

  return (
    <main className="shell">
      <h1 style={{ fontSize: 24 }}>Google Диск</h1>
      {error ? (
        <>
          <p className="errorBar">{error}</p>
          <a className="primary" href={asset("/")}>Вернуться</a>
        </>
      ) : (
        <p className="muted">Подключаю Google Диск…</p>
      )}
    </main>
  );
}

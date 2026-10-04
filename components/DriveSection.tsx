"use client";

import { useEffect, useState } from "react";
import { connectDrive, disconnectDrive, driveQuota, getDriveToken, isDriveEnabled, onDriveChange } from "@/lib/media/gdrive";
import { onSyncChange, pendingDriveCount, syncPendingUploads } from "@/lib/media/store";

function fmtBytes(n: number) {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} ТБ`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`;
  return `${Math.round(n / 1024 ** 2)} МБ`;
}

export function useDriveState() {
  const [, setTick] = useState(0);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setTick((t) => t + 1);
      pendingDriveCount().then(setPending).catch(() => undefined);
    };
    refresh();
    const a = onDriveChange(refresh);
    const b = onSyncChange(refresh);
    const t = setInterval(refresh, 30_000);
    return () => {
      a();
      b();
      clearInterval(t);
    };
  }, []);
  return { enabled: isDriveEnabled(), active: Boolean(getDriveToken()), pending };
}

/** Блок «Google Диск» в окне аккаунта. */
export function DriveSection() {
  const { enabled, active, pending } = useDriveState();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number | null } | null>(null);

  useEffect(() => {
    if (active) driveQuota().then(setQuota).catch(() => undefined);
  }, [active]);

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      await connectDrive();
      setMsg({ text: "Google Диск подключён. Новые фото и видео будут сохраняться туда в исходном качестве." });
      await syncPendingUploads();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="driveBox">
      <div className="driveHead">
        <span className="driveLogo" aria-hidden>
          ▲
        </span>
        <div>
          <strong>Google Диск</strong>
          <p className="muted small">
            {enabled ? (active ? "Подключён · оригиналы сохраняются в папку «Моя история»" : "Подключён · нужно подтвердить вход") : "Оригиналы фото и видео — на ваш Диск, без сжатия"}
          </p>
        </div>
      </div>

      {quota && (
        <div className="quota">
          <div className="quotaBar">
            <i style={{ width: `${quota.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 4}%` }} />
          </div>
          <span className="muted small">
            Занято {fmtBytes(quota.used)}
            {quota.limit ? ` из ${fmtBytes(quota.limit)}` : ""}
          </span>
        </div>
      )}

      {pending > 0 && (
        <p className="muted small">
          Ждут загрузки на Диск: <strong>{pending}</strong>
        </p>
      )}

      <div className="editorActions">
        {enabled && (
          <button type="button" className="softBtn" onClick={() => (disconnectDrive(), setQuota(null))} disabled={busy}>
            Отключить
          </button>
        )}
        {(!enabled || !active) && (
          <button type="button" className="primary" onClick={connect} disabled={busy}>
            {enabled ? "Подтвердить вход" : "Подключить Google Диск"}
          </button>
        )}
        {enabled && active && pending > 0 && (
          <button type="button" className="primary" onClick={() => void syncPendingUploads()} disabled={busy}>
            Загрузить сейчас
          </button>
        )}
      </div>
      {msg && <p className={msg.error ? "errorBar" : "okBar"}>{msg.text}</p>}
    </div>
  );
}

/** Плашка внизу экрана, если файлы ждут загрузки, а доступ к Диску истёк. */
export function DriveBanner() {
  const { enabled, active, pending } = useDriveState();
  const [busy, setBusy] = useState(false);
  if (!enabled || active || pending === 0) return null;
  return (
    <button
      type="button"
      className="driveBanner"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await connectDrive();
          await syncPendingUploads();
        } catch {
          /* пользователь закрыл окно */
        } finally {
          setBusy(false);
        }
      }}
    >
      ▲ {pending} {pending === 1 ? "файл ждёт" : "файлов ждут"} загрузки на Google Диск · Продолжить
    </button>
  );
}

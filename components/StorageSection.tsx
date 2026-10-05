"use client";

import { useEffect, useState } from "react";
import { getDriveToken, isDriveEnabled, onDriveChange } from "@/lib/media/gdrive";
import { deleteSupabaseCopies, moveOriginalsToDrive, storagePlan, SUPABASE_FREE_LIMIT, type StoragePlan } from "@/lib/media/migrate";
import { errorText } from "@/lib/useTrip";
import { plural } from "@/lib/format";

export function fmtBytes(n: number) {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} ТБ`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} МБ`;
  return `${Math.max(0, Math.round(n / 1024))} КБ`;
}

/** Место в Supabase и перенос оригиналов на Google Диск («Перенести хранилище»). */
export function StorageSection() {
  const [plan, setPlan] = useState<StoragePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [, setTick] = useState(0);

  const refresh = () => storagePlan().then(setPlan).catch(() => undefined);
  useEffect(() => {
    void refresh();
    return onDriveChange(() => setTick((t) => t + 1));
  }, []);

  if (!plan) return null;
  const driveReady = isDriveEnabled() && Boolean(getDriveToken());
  const pct = Math.min(100, (plan.supabaseBytes / SUPABASE_FREE_LIMIT) * 100);

  async function move() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await moveOriginalsToDrive((d, t) => setProgress(`Перенесено ${d} из ${t}…`));
      setMsg({ text: `Готово: перенесено ${r.moved}${r.failed ? `, не удалось ${r.failed} (повторите позже)` : ""}. Копии в Supabase пока сохранены.` });
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setProgress(null);
      setBusy(false);
      void refresh();
    }
  }

  async function cleanup() {
    if (!plan) return;
    if (!confirm(`Удалить из Supabase ${plan.removable.length} оригиналов (${fmtBytes(plan.removableBytes)})? У каждого есть проверенная копия на Google Диске. Превью останутся.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await deleteSupabaseCopies();
      setMsg({ text: `Освобождено ${fmtBytes(r.bytes)} (${r.deleted} ${plural(r.deleted, "файл", "файла", "файлов")}).` });
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <div className="driveBox storageBox">
      <div className="driveHead">
        <span className="driveLogo sb" aria-hidden>
          ◆
        </span>
        <div>
          <strong>Облако приложения</strong>
          <p className="muted small">Превью и файлы, загруженные до подключения Диска</p>
        </div>
      </div>
      <div className="quota">
        <div className={`quotaBar ${pct > 80 ? "warn" : ""}`}>
          <i style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <span className="muted small">
          Занято {fmtBytes(plan.supabaseBytes)} из 1 ГБ
        </span>
      </div>

      {plan.toMove.length > 0 && (
        <p className="muted small">
          Можно перенести на Google Диск: <strong>{plan.toMove.length}</strong> ({fmtBytes(plan.toMoveBytes)})
        </p>
      )}
      {progress && <p className="okBar">{progress}</p>}

      <div className="editorActions">
        {plan.toMove.length > 0 && (
          <button type="button" className="primary" disabled={busy || !driveReady} onClick={move} title={driveReady ? "" : "Сначала подключите Google Диск"}>
            Перенести на Google Диск
          </button>
        )}
        {plan.removable.length > 0 && (
          <button type="button" className="softBtn" disabled={busy} onClick={cleanup}>
            Освободить {fmtBytes(plan.removableBytes)}
          </button>
        )}
      </div>
      {plan.toMove.length > 0 && !driveReady && <p className="hint">Чтобы перенести, подключите Google Диск выше.</p>}
      {msg && <p className={msg.error ? "errorBar" : "okBar"}>{msg.text}</p>}
    </div>
  );
}

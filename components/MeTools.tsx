"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { disableLock, enableLock, lockEnabled, lockSupported } from "@/lib/applock";
import { buildArchive, restoreArchive } from "@/lib/archive";
import { saveFile, today } from "@/lib/download";
import { deleteOrphans, findOrphans, type Orphan } from "@/lib/media/orphans";
import { disableReminders, enableReminders, remindersEnabled } from "@/lib/reminders";
import { getUserId } from "@/lib/supabase";
import { errorText } from "@/lib/useTrip";
import { Icon } from "./Icon";
import { MediaImg } from "./media/Media";
import { fmtBytes } from "./StorageSection";

/** Раздел «Я»: напоминания, замок, архив, очистка неиспользуемых файлов. */
export function MeTools() {
  const [reminders, setReminders] = useState(false);
  const [lock, setLock] = useState(false);
  const [canLock, setCanLock] = useState(false);
  const [account, setAccount] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);

  useEffect(() => {
    setReminders(remindersEnabled());
    setLock(lockEnabled());
    lockSupported().then(setCanLock);
    getUserId().then((u) => setAccount(Boolean(u)));
  }, []);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text });
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  const toggleReminders = () =>
    run("reminders", async () => {
      if (reminders) {
        await disableReminders();
        setReminders(false);
        return "Напоминания выключены.";
      }
      const r = await enableReminders();
      setReminders(r.ok);
      if (!r.ok) throw new Error(r.message);
      return r.message;
    });

  const toggleLock = () =>
    run("lock", async () => {
      if (lock) {
        disableLock();
        setLock(false);
        return "Блокировка выключена.";
      }
      if (!account) throw new Error("Сначала войдите в аккаунт: если Face ID не сработает, блокировку можно будет снять паролем.");
      await enableLock();
      setLock(true);
      return "Готово: при открытии приложение попросит Face ID / отпечаток.";
    });

  const exportArchive = (previews: boolean) =>
    run(previews ? "export-full" : "export", async () => {
      const blob = await buildArchive(previews, (s) => setBusy(s));
      const r = await saveFile(blob, `moya-istoriya-${today()}.json`, { title: "Архив «Моя история»" });
      return r === "cancelled" ? "" : `Архив готов (${fmtBytes(blob.size)}). Храните его в «Файлах» или на Google Диске.`;
    });

  const restore = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    void run("restore", async () => {
      const r = await restoreArchive(f, (s) => setBusy(s));
      return `Восстановлено: ${r.added}. Уже были: ${r.skipped}. Превью фото: ${r.previews}.`;
    });
  };

  const scan = () =>
    run("scan", async () => {
      const list = await findOrphans();
      setOrphans(list);
      return list.length ? "" : "Неиспользуемых файлов нет.";
    });

  const clean = () => {
    if (!orphans?.length) return;
    const size = orphans.reduce((s, o) => s + o.size, 0);
    if (!confirm(`Удалить ${orphans.length} неиспользуемых файлов (${fmtBytes(size)})? Они не привязаны ни к одному моменту, в том числе в корзине. Файлы на Google Диске попадут в корзину Диска (30 дней).`)) return;
    void run("clean", async () => {
      const r = await deleteOrphans(orphans, (s) => setBusy(s));
      setOrphans(null);
      return `Удалено: ${r.deleted}${r.skipped ? `. Пропущено: ${r.skipped} (подключите Google Диск и повторите)` : ""}.`;
    });
  };

  const orphanSize = orphans?.reduce((s, o) => s + o.size, 0) ?? 0;

  return (
    <div className="meTools">
      <div className="settingsList">
        <button className="settingsRow" onClick={toggleReminders} disabled={Boolean(busy)}>
          <Icon name="calendar" size={20} />
          <span>Напоминания «Этот день»</span>
          <span className={`switch ${reminders ? "on" : ""}`} aria-hidden />
        </button>
        {canLock && (
          <button className="settingsRow" onClick={toggleLock} disabled={Boolean(busy)}>
            <Icon name="user" size={20} />
            <span>Вход по Face ID / отпечатку</span>
            <span className={`switch ${lock ? "on" : ""}`} aria-hidden />
          </button>
        )}
      </div>

      <h3 className="meH3">Архив</h3>
      <div className="settingsList">
        <button className="settingsRow" onClick={() => exportArchive(false)} disabled={Boolean(busy)}>
          <Icon name="share" size={20} />
          <span>Скачать архив (тексты, места, даты)</span>
        </button>
        <button className="settingsRow" onClick={() => exportArchive(true)} disabled={Boolean(busy)}>
          <Icon name="photo" size={20} />
          <span>Скачать архив с превью фото</span>
        </button>
        <label className="settingsRow">
          <Icon name="sync" size={20} />
          <span>Восстановить из архива</span>
          <input type="file" accept="application/json,.json" hidden onChange={restore} />
        </label>
      </div>
      <p className="hint">Оригиналы фото и видео остаются на Google Диске — в архиве записано, какой файл к какому моменту относится.</p>

      <h3 className="meH3">Неиспользуемые файлы</h3>
      <div className="settingsList">
        <button className="settingsRow" onClick={scan} disabled={Boolean(busy)}>
          <Icon name="search" size={20} />
          <span>Найти файлы, не привязанные к моментам</span>
        </button>
      </div>
      {orphans && orphans.length > 0 && (
        <div className="orphanBox">
          <p>
            Найдено {orphans.length} ({fmtBytes(orphanSize)}). Это фото и видео, которые убрали из моментов.
          </p>
          <div className="impThumbs">
            {orphans.slice(0, 12).map((o) => (
              <span key={o.id} className="impThumb">
                <MediaImg id={o.id} />
              </span>
            ))}
          </div>
          <button className="softBtn danger" onClick={clean} disabled={Boolean(busy)}>
            Удалить их
          </button>
        </div>
      )}

      {busy && busy.length > 12 && <p className="hint">{busy}</p>}
      {msg && <p className={msg.error ? "errorBar" : "okBar"}>{msg.text}</p>}
    </div>
  );
}

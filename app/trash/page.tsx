"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { MediaImg } from "@/components/media/Media";
import { plural } from "@/lib/format";
import { getRepo, TRASH_DAYS } from "@/lib/repo";
import { routes } from "@/lib/routes";
import { kindLabel, tripCover, tripDateRange } from "@/lib/stats";
import type { Trip } from "@/lib/types";

const daysLeft = (t: Trip) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(t.meta!.deletedAt!).getTime()) / 86_400_000));

/** Корзина: удалённые поездки и события хранятся 30 дней, их можно вернуть. */
export default function TrashPage() {
  const [items, setItems] = useState<Trip[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    getRepo()
      .then((r) => r.listTrash())
      .then(setItems)
      .catch((e) => {
        setErr(String(e?.message ?? e));
        setItems([]);
      });
  }, []);
  useEffect(load, [load]);

  async function act(t: Trip, what: "restore" | "purge") {
    if (what === "purge" && !confirm(`Удалить «${t.title}» навсегда? Это нельзя отменить. Сами файлы фото и видео на Google Диске останутся.`)) return;
    setBusy(t.id);
    try {
      const r = await getRepo();
      if (what === "restore") await r.restore(t.id);
      else await r.purge(t.id);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="shell trashPage">
      <header className="nmHead">
        <Link href={routes.me} className="iconBtnPlain" aria-label="Назад">
          <Icon name="back" />
        </Link>
        <h1>Корзина</h1>
        <span style={{ width: 40 }} />
      </header>
      <p className="hint">Удалённые поездки и события хранятся здесь {TRASH_DAYS} дней, потом удаляются окончательно.</p>
      {err && <p className="errorBar">{err}</p>}
      {items === null && <p className="muted">Загрузка…</p>}
      {items?.length === 0 && <p className="muted trashEmpty">Корзина пуста.</p>}
      <div className="trashList">
        {items?.map((t) => {
          const cover = tripCover(t);
          const left = daysLeft(t);
          return (
            <div key={t.id} className="trashItem">
              <span className="trashThumb">{cover ? <MediaImg id={cover} /> : <Icon name="route" size={20} />}</span>
              <span className="trashText">
                <strong>{t.title}</strong>
                <span className="muted small">
                  {kindLabel(t)} · {tripDateRange(t)}
                </span>
                <span className="muted small">
                  Удалится через {left} {plural(left, "день", "дня", "дней")}
                </span>
              </span>
              <span className="trashActions">
                <button className="softBtn" disabled={busy === t.id} onClick={() => act(t, "restore")}>
                  Восстановить
                </button>
                <button className="linkBtn danger" disabled={busy === t.id} onClick={() => act(t, "purge")}>
                  Удалить навсегда
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </main>
  );
}

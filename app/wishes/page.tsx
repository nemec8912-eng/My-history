"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { PlacePicker } from "@/components/PlacePicker";
import { createCheckpoint, newId } from "@/lib/markerStyle";
import { getRepo, newTrip } from "@/lib/repo";
import { routes } from "@/lib/routes";
import { useUserData } from "@/lib/userdata";
import { localToday } from "@/lib/format";
import type { Location, Wish } from "@/lib/types";
import { BackLink } from "@/components/BackLink";

/** «Хочу поехать»: места-мечты. Одним касанием превращаются в поездку. */
export default function WishesPage() {
  const router = useRouter();
  const { data, update } = useUserData();
  const [title, setTitle] = useState("");
  const [loc, setLoc] = useState<Location | undefined>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const wishes = data?.wishes ?? [];
  const open = wishes.filter((w) => !w.doneTripId);
  const done = wishes.filter((w) => w.doneTripId);

  function add() {
    const name = title.trim() || loc?.label?.split(",")[0];
    if (!name) return;
    const w: Wish = { id: newId(), title: name, location: loc && (loc.lat || loc.lon) ? loc : undefined, note: note.trim() || undefined, createdAt: new Date().toISOString() };
    void update((d) => ({ ...d, wishes: [w, ...(d.wishes ?? [])] }));
    setTitle("");
    setLoc(undefined);
    setNote("");
  }

  async function go(w: Wish) {
    setBusy(w.id);
    try {
      const today = localToday();
      const start = createCheckpoint("start", { title: "Дом", time: undefined });
      const end = createCheckpoint("end", { title: w.title, location: w.location, description: w.note });
      const t = newTrip({ title: w.title, date: today, place: w.location?.label?.split(",").slice(1).join(",").trim() || undefined, checkpoints: [start, end], meta: { kind: "trip" } });
      await (await getRepo()).save(t);
      await update((d) => ({ ...d, wishes: (d.wishes ?? []).map((x) => (x.id === w.id ? { ...x, doneTripId: t.id } : x)) }));
      router.push(routes.trip(t.id));
    } catch (e) {
      alert("Не удалось создать поездку: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  const remove = (w: Wish) => confirm(`Убрать «${w.title}» из списка?`) && update((d) => ({ ...d, wishes: (d.wishes ?? []).filter((x) => x.id !== w.id) }));

  return (
    <main className="shell wishesPage">
      <header className="nmHead">
        <BackLink href={routes.me} className="iconBtnPlain">
          <Icon name="back" />
        </BackLink>
        <h1>Хочу поехать</h1>
        <Link href={routes.nearby()} className="iconBtnPlain" aria-label="Интересное рядом">
          <Icon name="star" />
        </Link>
      </header>

      <div className="wishForm">
        <PlacePicker value={loc} onChange={setLoc} />
        <input placeholder="Название (например, «Байкал зимой»)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Заметка: когда, с кем, что посмотреть" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="primary" onClick={add} disabled={!title.trim() && !loc?.label}>
          + Добавить мечту
        </button>
      </div>

      {data === null && <p className="muted">Загрузка…</p>}
      {data && open.length === 0 && <p className="muted">Пока пусто. Добавьте место, куда хочется съездить, — оно появится на карте звёздочкой.</p>}
      <div className="wishList">
        {open.map((w) => (
          <div key={w.id} className="wishItem">
            <span className="wishStar">⭐</span>
            <span className="wishText">
              <strong>{w.title}</strong>
              {w.location?.label && <span className="muted small">{w.location.label}</span>}
              {w.note && <span className="small">{w.note}</span>}
            </span>
            <span className="wishActions">
              <button className="primary" disabled={busy === w.id} onClick={() => go(w)}>
                Поехали!
              </button>
              <button className="linkBtn danger" onClick={() => remove(w)}>
                Убрать
              </button>
            </span>
          </div>
        ))}
      </div>

      {done.length > 0 && (
        <>
          <h3 className="meH3">Сбылось</h3>
          <div className="wishList">
            {done.map((w) => (
              <Link key={w.id} className="wishItem done" href={routes.trip(w.doneTripId!)}>
                <span className="wishStar">✅</span>
                <span className="wishText">
                  <strong>{w.title}</strong>
                  {w.location?.label && <span className="muted small">{w.location.label}</span>}
                </span>
                <Icon name="chevron" size={16} />
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MediaImg, MediaPicker } from "@/components/media/Media";
import { Sheet } from "@/components/Sheet";
import { AccountSheet } from "@/components/AccountSheet";
import { StoryRoute } from "@/components/story/StoryRoute";
import { getSupabase } from "@/lib/supabase";
import { routes } from "@/lib/routes";
import { formatDate, plural } from "@/lib/format";
import { createCheckpoint } from "@/lib/markerStyle";
import { getRepo, localTripCount, newTrip } from "@/lib/repo";
import type { Checkpoint, Trip } from "@/lib/types";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
}

function demoTrip(): Trip {
  const p = (title: string, time: string, icon: string, color: string, extra: Partial<Checkpoint> = {}) =>
    createCheckpoint("regular", { title, time, icon, style: { shape: "circle", color, size: "m", showLabel: false, showPhoto: true }, ...extra });
  return newTrip({
    title: "Поездка в зоопарк (пример)",
    date: today(),
    place: "Москва",
    description: "Пример поездки: откройте любую точку, добавьте фото, поменяйте форму, цвет и размер.",
    checkpoints: [
      createCheckpoint("start", { title: "Дом", time: "08:00", icon: "🏠", description: "Выезд из дома", location: { lat: 56.0123, lon: 37.4745, label: "Лобня" } }),
      p("Станция", "08:20", "🚉", "#2f6bff", { description: "Станция Лобня", arrivedBy: "walk", location: { lat: 56.0136, lon: 37.4824, label: "Лобня" } }),
      p("Савёловский вокзал", "08:55", "🚆", "#2f6bff", { description: "Доехали на электричке", arrivedBy: "train", style: { shape: "square", color: "#2f6bff", size: "m", showLabel: false, showPhoto: true } }),
      p("Метро", "09:05", "🚇", "#ef3b4a", { description: "Савёловская", arrivedBy: "walk", importance: 1, location: { lat: 55.7939, lon: 37.5871 } }),
      p("Пересадка", "09:30", "🔁", "#8b3dff", { arrivedBy: "metro", style: { shape: "diamond", color: "#8b3dff", size: "s", showLabel: false, showPhoto: true } }),
      p("Кафе", "10:10", "☕", "#ff8a1f", { description: "Завтрак в кафе", arrivedBy: "metro", importance: 2, style: { shape: "circle", color: "#ff8a1f", size: "l", showLabel: false, showPhoto: true } }),
      p("Парк", "10:45", "🌳", "#16a36a", { description: "Прогулка по парку", arrivedBy: "walk", style: { shape: "triangle", color: "#16a36a", size: "m", showLabel: false, showPhoto: true } }),
      createCheckpoint("end", {
        title: "Московский зоопарк",
        time: "11:20",
        arrivedBy: "walk",
        icon: "🐘",
        description: "Основная локация поездки",
        location: { lat: 55.7612, lon: 37.5784, label: "Большая Грузинская ул., 1" },
        place: { arrivedAt: "11:20", leftAt: "16:30", moments: [] },
      }),
    ],
  });
}

export default function Home() {
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", date: today(), time: "", place: "", text: "", from: "", to: "", cover: undefined as string | undefined });

  const [account, setAccount] = useState<false | "signin" | "newPassword">(false);
  const [authNote, setAuthNote] = useState<string | null>(null);
  const [cloud, setCloud] = useState(false);
  const [pendingLocal, setPendingLocal] = useState(0);

  const reload = useCallback(() => {
    getRepo()
      .then((r) => {
        setCloud(r.mode === "cloud");
        if (r.mode === "cloud") localTripCount().then(setPendingLocal).catch(() => undefined);
        else setPendingLocal(0);
        return r.list();
      })
      .then(setTrips)
      .catch(() => setTrips([]));
  }, []);

  useEffect(() => {
    reload();
    const sb = getSupabase();
    if (!sb) return;
    // Ошибка из ссылки письма (например, ссылка устарела) приходит в адресе страницы.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const linkError = hash.get("error_description");
    if (linkError) {
      setAuthNote(linkError.includes("expired") ? "Ссылка из письма устарела — запросите новую." : linkError);
      history.replaceState(null, "", window.location.pathname);
    }
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setAccount("newPassword");
      if (event === "SIGNED_IN") setAuthNote(null);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") reload();
    });
    return () => data.subscription.unsubscribe();
  }, [reload]);

  const latest = trips && trips.length ? trips[0] : null;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rest = trips ? trips.slice(1) : [];
  // Поиск с первых букв: сначала названия, начинающиеся с запроса, затем совпадения с начала слова, затем любые.
  const found = useMemo(() => {
    if (!q || !trips) return [];
    const scored = trips
      .map((t) => {
        const title = t.title.toLowerCase();
        const text = [t.title, t.place, t.description, ...t.checkpoints.map((c) => `${c.title} ${c.description ?? ""} ${c.location?.label ?? ""}`)]
          .join(" ")
          .toLowerCase();
        let score = -1;
        if (title.startsWith(q)) score = 0;
        else if (title.split(/[\s,.()«»-]+/).some((w) => w.startsWith(q))) score = 1;
        else if (text.split(/[\s,.()«»-]+/).some((w) => w.startsWith(q))) score = 2;
        else if (text.includes(q)) score = 3;
        return { t, score };
      })
      .filter((x) => x.score >= 0);
    scored.sort((a, b) => a.score - b.score || b.t.date.localeCompare(a.t.date));
    return scored.map((x) => x.t);
  }, [q, trips]);

  const totals = useMemo(() => {
    const list = trips ?? [];
    return {
      trips: list.length,
      media: list.reduce((s, t) => s + t.mediaIds.length + t.checkpoints.reduce((a, c) => a + c.mediaIds.length, 0), 0),
    };
  }, [trips]);

  async function create(trip: Trip) {
    setBusy(true);
    try {
      await (await getRepo()).save(trip);
      router.push(routes.trip(trip.id));
    } catch (e) {
      alert("Не удалось сохранить: " + (e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const start = createCheckpoint("start", { title: draft.from.trim() || "Начало пути", time: draft.time || undefined });
    const end = createCheckpoint("end", { title: draft.to.trim() || draft.title.trim() });
    void create(
      newTrip({
        title: draft.title.trim(),
        date: draft.date,
        time: draft.time || undefined,
        place: draft.place.trim() || undefined,
        description: draft.text.trim() || undefined,
        coverMediaId: draft.cover,
        mediaIds: draft.cover ? [draft.cover] : [],
        checkpoints: [start, end],
      })
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1>Моя история</h1>
        </div>
        <button className={`avatar ${cloud ? "online" : ""}`} aria-label="Аккаунт" onClick={() => setAccount("signin")}>Я</button>
      </header>

      {trips && trips.length > 1 && (
        <div className="searchWrap">
          <span className="searchIcon" aria-hidden>⌕</span>
          <input
            className="searchInput"
            type="search"
            placeholder="Поиск по поездкам, точкам, заметкам…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
          />
          {query && (
            <button className="searchClear" aria-label="Очистить" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </div>
      )}

      {q ? (
        <section className="section">
          <div className="sectionTitle">
            <h3>Найдено: {found.length}</h3>
          </div>
          {found.length === 0 && <p className="muted">Ничего не найдено. Попробуйте другие буквы.</p>}
          <div className="tripRows">
            {found.map((t) => <TripRowLink key={t.id} t={t} q={q} />)}
          </div>
        </section>
      ) : latest ? (
        <section className="journey" aria-label="Последняя поездка">
          <div className="journeyHead">
            <div>
              <p className="eyebrow">Последняя поездка</p>
              <h2>{latest.title}</h2>
              <p className="journeyMeta">
                {formatDate(latest.date)}
                {latest.place ? ` · ${latest.place}` : ""} · {latest.checkpoints.length} {plural(latest.checkpoints.length, "точка", "точки", "точек")}
              </p>
            </div>
            <Link className="journeyOpen" href={routes.trip(latest.id)} aria-label="Открыть поездку">›</Link>
          </div>
          <div className="nightPanel">
            <StoryRoute trip={latest} preview onOpen={() => router.push(routes.trip(latest.id))} />
          </div>
          <div className="journeyActions">
            <Link className="primary" href={routes.trip(latest.id)}>Открыть историю</Link>
            <button className="ghostLight" onClick={() => setOpen(true)}>+ Новая поездка</button>
          </div>
        </section>
      ) : (
        <section className="hero">
          <div>
            <p className="eyebrow">Твои воспоминания</p>
            <h2>Каждая поездка — отдельная история пути</h2>
            <p className="muted">Отмечай точки пути снизу вверх: фото, заметки, адреса — и маршрут волной соединит их в историю.</p>
          </div>
          <div className="heroActions">
            <button className="primary" onClick={() => setOpen(true)}>+ Новая поездка</button>
            {trips && <button className="softBtn" disabled={busy} onClick={() => create(demoTrip())}>Открыть пример</button>}
          </div>
        </section>
      )}

      {authNote && <p className="errorBar">{authNote}</p>}

      {cloud && pendingLocal > 0 && (
        <button className="syncBanner" onClick={() => setAccount("signin")}>
          На этом устройстве есть поездки ({pendingLocal}), которых нет в аккаунте. Перенести ›
        </button>
      )}

      {!q && <section className="stats">
        <div><strong>{totals.trips}</strong><span>{plural(totals.trips, "поездка", "поездки", "поездок")}</span></div>
        <div><strong>{totals.media}</strong><span>{plural(totals.media, "файл", "файла", "файлов")}</span></div>
      </section>}

      {!q && (
      <section className="section">
        <div className="sectionTitle">
          <h3>{latest ? "Все поездки" : "Мои поездки"}</h3>
          {latest && <button className="ghost" onClick={() => setOpen(true)}>+ Новая</button>}
        </div>

        {latest && rest.length === 0 && <p className="muted small">Здесь появятся остальные поездки.</p>}

        {trips && trips.length === 0 && (
          <div className="emptyCard">
            <p>Здесь появятся ваши поездки.</p>
            <div className="heroActions">
              <button className="primary" onClick={() => setOpen(true)}>Создать поездку</button>
            </div>
          </div>
        )}

        <div className="tripRows">
          {rest.map((t) => <TripRowLink key={t.id} t={t} />)}
        </div>
        {trips && trips.length > 0 && (
          <button className="softBtn" style={{ marginTop: 16 }} disabled={busy} onClick={() => create(demoTrip())}>
            + Пример поездки
          </button>
        )}
      </section>
      )}

      {account && <AccountSheet initialStage={account} onClose={() => setAccount(false)} onChanged={reload} />}

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <form className="editor" onSubmit={submit}>
            <p className="eyebrow">Новая история</p>
            <h3>Новая поездка</h3>
            <label>
              Название
              <input required placeholder="Например, Московский зоопарк" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <div className="row">
              <label>
                Дата
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label>
                Время выхода
                <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label>
                Откуда
                <input placeholder="Дом" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              </label>
              <label>
                Куда
                <input placeholder="Московский зоопарк" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </label>
            </div>
            <label>
              Город / место
              <input placeholder="Москва" value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} />
            </label>
            <label>
              Описание
              <textarea rows={3} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </label>
            <fieldset>
              <legend>Обложка</legend>
              {draft.cover && <MediaImg id={draft.cover} variant="original" className="coverPreview" />}
              <MediaPicker kinds={["image"]} onAdd={(items) => setDraft((d) => ({ ...d, cover: items.find((i) => i.kind === "image")?.id ?? d.cover }))} />
            </fieldset>
            <button className="primary wide" type="submit" disabled={busy}>Создать и открыть</button>
          </form>
        </Sheet>
      )}
    </main>
  );
}

function Highlight({ text, q }: { text: string; q?: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="hl">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function TripRowLink({ t, q }: { t: Trip; q?: string }) {
  const media = t.mediaIds.length + t.checkpoints.reduce((a, c) => a + c.mediaIds.length, 0);
  const cover = t.coverMediaId ?? t.checkpoints.find((c) => c.coverMediaId)?.coverMediaId;
  const end = t.checkpoints[t.checkpoints.length - 1];
  const hitPoint = q && !t.title.toLowerCase().includes(q) ? t.checkpoints.find((c) => `${c.title} ${c.description ?? ""} ${c.location?.label ?? ""}`.toLowerCase().includes(q)) : undefined;
  return (
    <Link className="tripRow" href={routes.trip(t.id)}>
      <span className="tripRowCover" style={{ background: end?.style.color }}>
        {cover ? <MediaImg id={cover} /> : <span>{end?.icon ?? "★"}</span>}
      </span>
      <span className="tripRowText">
        <strong>
          <Highlight text={t.title} q={q} />
        </strong>
        <span className="muted small">
          {formatDate(t.date)} · {t.checkpoints.length} {plural(t.checkpoints.length, "точка", "точки", "точек")}
          {media ? ` · ${media} ${plural(media, "файл", "файла", "файлов")}` : ""}
        </span>
        {hitPoint && (
          <span className="small hitPoint">
            в точке «<Highlight text={hitPoint.title} q={q} />»
          </span>
        )}
      </span>
      <span className="tripRowChevron">›</span>
    </Link>
  );
}

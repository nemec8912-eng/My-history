"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { MediaImg, MediaPicker } from "@/components/media/Media";
import { useMediaMetas } from "@/components/media/useMedia";
import { Sheet } from "@/components/Sheet";
import { AccountSheet } from "@/components/AccountSheet";
import { TabScreen } from "@/components/BottomNav";
import { Icon } from "@/components/Icon";
import { getSupabase } from "@/lib/supabase";
import { routes } from "@/lib/routes";
import { plural } from "@/lib/format";
import { createCheckpoint } from "@/lib/markerStyle";
import { getRepo, localTripCount, newTrip } from "@/lib/repo";
import { isEvent, kindLabel, momentDate, tripCover, tripDateRange, tripDays, tripKm, tripMediaIds } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";
import type { Checkpoint, Trip } from "@/lib/types";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function demoTrip(): Trip {
  const p = (title: string, time: string, icon: string, color: string, extra: Partial<Checkpoint> = {}) =>
    createCheckpoint("regular", { title, time, icon, style: { shape: "circle", color, size: "m", showLabel: false, showPhoto: true }, ...extra });
  return newTrip({
    title: "Поездка в зоопарк (пример)",
    meta: { kind: "trip" },
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


/** Цифры поездки для чипов: только то, что реально есть. */
function useTripChips(t: Trip) {
  const metas = useMediaMetas(tripMediaIds(t));
  const photos = metas.filter((m) => m.kind === "image").length;
  const videos = metas.filter((m) => m.kind === "video").length;
  const km = tripKm(t);
  const days = tripDays(t);
  return { photos, videos, km, days };
}

function Chips({ t, compact }: { t: Trip; compact?: boolean }) {
  const { photos, videos, km, days } = useTripChips(t);
  return (
    <div className={`tChips ${compact ? "compact" : ""}`}>
      {!isEvent(t) && (
        <span>
          <Icon name="calendar" size={15} /> {days} {plural(days, "день", "дня", "дней")}
        </span>
      )}
      {km != null && km >= 0.1 && (
        <span>
          <Icon name="route" size={15} /> {km >= 10 ? Math.round(km) : km.toFixed(1)} км
        </span>
      )}
      {photos > 0 && (
        <span>
          <Icon name="photo" size={15} /> {photos} фото
        </span>
      )}
      {!compact && videos > 0 && (
        <span>
          <Icon name="video" size={15} /> {videos} видео
        </span>
      )}
      {isEvent(t) && <span className="kindTag">Событие</span>}
    </div>
  );
}

function CoverBg({ t, className }: { t: Trip; className?: string }) {
  const cover = tripCover(t);
  const color = t.checkpoints[t.checkpoints.length - 1]?.style.color ?? "#2f7bff";
  return (
    <div className={`coverBg ${className ?? ""}`} style={{ ["--c" as string]: color }}>
      {cover ? <MediaImg id={cover} variant="original" /> : <span className="coverEmpty">{t.checkpoints.find((c) => c.icon)?.icon ?? "🗺"}</span>}
      <i className="coverShade" />
    </div>
  );
}

/** «Этот день»: реальные поездки и моменты прошлых лет в эту же дату. */
function useThisDay(trips: Trip[] | null) {
  return useMemo(() => {
    if (!trips) return [];
    const now = today();
    const md = now.slice(5);
    const year = Number(now.slice(0, 4));
    const hits: { t: Trip; cp?: Checkpoint; years: number }[] = [];
    for (const t of trips) {
      const tripHit = t.date.slice(5) === md && Number(t.date.slice(0, 4)) < year;
      const cp = t.checkpoints.find((c) => {
        const d = momentDate(t, c);
        return d.slice(5) === md && Number(d.slice(0, 4)) < year;
      });
      if (tripHit || cp) {
        const d = cp ? momentDate(t, cp) : t.date;
        hits.push({ t, cp, years: year - Number(d.slice(0, 4)) });
      }
    }
    return hits.sort((a, b) => a.years - b.years);
  }, [trips]);
}

function ThisDayCard({ hit }: { hit: { t: Trip; cp?: Checkpoint; years: number } }) {
  const { t, cp, years } = hit;
  const [, m, d] = today().split("-").map(Number);
  const place = cp?.title ?? t.title;
  const region = cp?.location?.label ?? t.place;
  const w = cp?.meta?.weather;
  const href = cp ? routes.moment(t.id, cp.id) : routes.trip(t.id);
  const cover = cp?.coverMediaId ?? tripCover(t);
  return (
    <Link className="thisDay" href={href}>
      <div className="coverBg">
        {cover ? <MediaImg id={cover} variant="original" /> : <span className="coverEmpty">✨</span>}
        <i className="coverShade" />
      </div>
      <div className="tdTop">
        <strong className="tdTitle">Этот день</strong>
        <span className="tdDate">{d} {RU_MONTHS_GEN[m - 1]}</span>
        <span className="tdAgo">
          {years} {plural(years, "год", "года", "лет")} назад
          <br />
          Вы были здесь
        </span>
      </div>
      <div className="tdBottom">
        <div>
          <strong>{place}</strong>
          {region && <span>{region}</span>}
        </div>
        {w && (
          <span className="tdWeather">
            {w.icon} {w.temp > 0 ? "+" : ""}
            {w.temp}°
          </span>
        )}
      </div>
    </Link>
  );
}

export default function Home() {
  const router = useRouter();
  const { trips, cloud, reload } = useTrips();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", date: today(), time: "", place: "", text: "", from: "", to: "", cover: undefined as string | undefined });
  const [account, setAccount] = useState<false | "signin" | "newPassword">(false);
  const [authNote, setAuthNote] = useState<string | null>(null);
  const [pendingLocal, setPendingLocal] = useState(0);
  const thisDay = useThisDay(trips);

  useEffect(() => {
    if (cloud) localTripCount().then(setPendingLocal).catch(() => undefined);
  }, [cloud, trips]);

  useEffect(() => {
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
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const recent = trips ?? [];
  const [first, ...others] = recent;

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
        meta: { kind: "trip" },
      })
    );
  }

  return (
    <TabScreen className="home">
      <header className="appHeader">
        <span className="ahSide" />
        <h1>Моя история</h1>
        <span className="ahSide right">
          <Link href={routes.search} className="iconBtnPlain" aria-label="Поиск">
            <Icon name="search" />
          </Link>
          <Link href={routes.me} className="iconBtnPlain" aria-label="Аккаунт">
            <Icon name="settings" />
          </Link>
        </span>
      </header>

      {authNote && <p className="errorBar">{authNote}</p>}
      {cloud && pendingLocal > 0 && (
        <Link className="syncBanner" href={routes.me}>
          На этом устройстве есть записи ({pendingLocal}), которых нет в аккаунте. Перенести ›
        </Link>
      )}

      {thisDay[0] && <ThisDayCard hit={thisDay[0]} />}

      {trips && trips.length === 0 && (
        <section className="welcome">
          <h2>Ваши воспоминания начнутся здесь</h2>
          <p className="muted">Поездка с маршрутом или просто событие на прогулке — фото, видео, голос и заметки в одном месте.</p>
          <div className="heroActions">
            <Link className="primary" href={routes.newMoment()}>+ Новый момент</Link>
            <button className="softBtn" onClick={() => setOpen(true)}>Новая поездка</button>
            <button className="softBtn" disabled={busy} onClick={() => create(demoTrip())}>Открыть пример</button>
          </div>
        </section>
      )}

      {first && (
        <section className="homeSection">
          <div className="sectionHead">
            <h2>Последние поездки</h2>
            <Link href={routes.timeline}>
              Все <Icon name="chevron" size={16} />
            </Link>
          </div>
          <Link className="bigTrip" href={routes.trip(first.id)}>
            <CoverBg t={first} />
            <div className="btText">
              <strong>{first.title}</strong>
              <span>{tripDateRange(first)}</span>
              <Chips t={first} />
            </div>
          </Link>
          {others.length > 0 && (
            <div className="tripGrid">
              {others.slice(0, 6).map((t) => (
                <Link key={t.id} className="smallTrip" href={routes.trip(t.id)}>
                  <CoverBg t={t} />
                  <div className="stText">
                    <strong>{t.title}</strong>
                    <span>{tripDateRange(t)}</span>
                    <Chips t={t} compact />
                  </div>
                </Link>
              ))}
            </div>
          )}
          <div className="homeActions">
            <button className="softBtn" onClick={() => setOpen(true)}>+ Новая поездка</button>
            <Link className="softBtn" href={routes.newMoment()}>+ Событие</Link>
          </div>
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
    </TabScreen>
  );
}

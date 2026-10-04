"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { MediaImg, MediaPicker } from "@/components/media/Media";
import { PlacePicker } from "@/components/PlacePicker";
import { addMediaFiles } from "@/lib/media/store";
import { createCheckpoint } from "@/lib/markerStyle";
import { getRepo, newTrip } from "@/lib/repo";
import { routes } from "@/lib/routes";
import { isEvent } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";
import { fetchWeather } from "@/lib/weather";
import { reverseInfo } from "@/lib/geocode";
import type { CheckpointMeta, Location, MediaItem, Weather } from "@/lib/types";

type MType = NonNullable<CheckpointMeta["type"]>;
const TYPES: { id: MType; label: string; icon: string }[] = [
  { id: "photo", label: "Фото", icon: "photo" },
  { id: "video", label: "Видео", icon: "video" },
  { id: "audio", label: "Аудио", icon: "audio" },
  { id: "note", label: "Заметка", icon: "note" },
];

function nowLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** «Новый момент» (экран 5): тип → место → время → описание → сохранить. */
export function NewMoment() {
  const router = useRouter();
  const preset = useSearchParams().get("trip");
  const { trips } = useTrips();
  const [type, setType] = useState<MType>("photo");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [busyMedia, setBusyMedia] = useState(false);
  const [loc, setLoc] = useState<Location | undefined>();
  const [when, setWhen] = useState(nowLocal());
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState<string>(preset ?? "event");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (preset) setTarget(preset);
  }, [preset]);

  // Погода подтягивается автоматически, когда известны место и время.
  useEffect(() => {
    setWeather(null);
    if (!loc || (!loc.lat && !loc.lon)) return;
    const t = setTimeout(() => {
      fetchWeather(loc.lat, loc.lon, when.slice(0, 10), when.slice(11, 16)).then(setWeather);
    }, 500);
    return () => clearTimeout(t);
  }, [loc, when]);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusyMedia(true);
    try {
      const items = await addMediaFiles(files);
      setMedia((m) => [...m, ...items]);
      // Первое фото с датой и GPS из EXIF само подставляет время и место (если они ещё не заданы).
      const shot = items.find((i) => i.takenAt || i.gps);
      if (shot && !media.length) {
        if (shot.takenAt) setWhen(shot.takenAt.slice(0, 16));
        if (shot.gps && !loc) {
          const g = shot.gps;
          setLoc({ lat: g.lat, lon: g.lon });
          reverseInfo(g.lat, g.lon, 16).then((info) => info && setLoc((l) => (l && l.lat === g.lat && l.lon === g.lon ? { ...l, label: info.label } : l)));
        }
      }
    } catch (er) {
      setErr("Не удалось сохранить файл: " + (er instanceof Error ? er.message : String(er)));
    } finally {
      setBusyMedia(false);
    }
  }

  async function save() {
    setErr(null);
    if (!media.length && !text.trim() && !title.trim()) return setErr("Добавьте фото, видео, голос или напишите пару слов.");
    setSaving(true);
    try {
      const date = when.slice(0, 10);
      const time = when.slice(11, 16) || undefined;
      let w = weather;
      if (!w && loc && (loc.lat || loc.lon)) w = await withTimeout(fetchWeather(loc.lat, loc.lon, date, time), 5000);
      const placeShort = loc?.label?.split(",")[0].trim();
      const name =
        title.trim() ||
        placeShort ||
        (text.trim() ? text.trim().split(/\s+/).slice(0, 5).join(" ") : TYPES.find((t) => t.id === type)!.label);
      const firstImage = media.find((m) => m.kind === "image");
      const cp = createCheckpoint("regular", {
        title: name,
        description: text.trim() || undefined,
        time,
        location: loc,
        mediaIds: media.map((m) => m.id),
        coverMediaId: firstImage?.id,
        meta: { date, type, ...(w ? { weather: w } : {}) },
      });
      const repo = await getRepo();
      let tripId: string;
      if (target === "event") {
        const t = newTrip({
          title: name,
          date,
          place: loc?.label?.split(",").slice(1).join(",").trim() || undefined,
          checkpoints: [cp],
          meta: { kind: "event" },
        });
        await repo.save(t);
        tripId = t.id;
      } else {
        const t = await repo.get(target);
        if (!t) throw new Error("Поездка не найдена");
        const list = [...t.checkpoints];
        const endIdx = list.findIndex((c) => c.kind === "end");
        list.splice(endIdx >= 0 ? endIdx : list.length, 0, cp);
        await repo.save({ ...t, checkpoints: list, updatedAt: new Date().toISOString() });
        tripId = t.id;
      }
      router.replace(routes.moment(tripId, cp.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const accept = type === "video" ? "video/*" : "image/*";
  const preview = media.find((m) => m.kind !== "audio");

  return (
    <main className="newMoment">
      <header className="nmHead">
        <Link href={preset ? routes.trip(preset) : routes.home} className="iconBtnPlain" aria-label="Назад">
          <Icon name="back" />
        </Link>
        <h1>Новый момент</h1>
        <button className="nmSave" onClick={save} disabled={saving || busyMedia}>
          {saving ? "…" : "Сохранить"}
        </button>
      </header>

      <div className="typeTabs">
        {TYPES.map((t) => (
          <button key={t.id} className={type === t.id ? "on" : ""} onClick={() => setType(t.id)}>
            <Icon name={t.icon} size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <Link className="impLink" href={routes.importPhotos}>
        <Icon name="grid" size={18} /> Импорт из галереи: много фото сразу, по дням и местам
        <Icon name="chevron" size={16} />
      </Link>

      {(type === "photo" || type === "video") && (
        <div className="nmMedia">
          {preview ? (
            <div className="nmPreview">
              <MediaImg id={preview.id} variant="original" />
              <button
                className="nmRemove"
                aria-label="Убрать"
                onClick={() => setMedia((m) => m.filter((x) => x.id !== preview.id))}
              >
                <Icon name="close" size={18} />
              </button>
              {media.length > 1 && <span className="heroCounter">+{media.length - 1}</span>}
            </div>
          ) : (
            <label className="nmDrop">
              <Icon name={type === "video" ? "video" : "photo"} size={34} />
              <span>{busyMedia ? "Сохраняю…" : type === "video" ? "Выбрать или снять видео" : "Выбрать или сделать фото"}</span>
              <input type="file" accept={accept} multiple onChange={pick} />
            </label>
          )}
          {preview && (
            <label className="pickBtn">
              + Ещё
              <input type="file" accept={accept} multiple onChange={pick} />
            </label>
          )}
        </div>
      )}

      {type === "audio" && (
        <div className="nmMedia">
          <MediaPicker kinds={["audio"]} onAdd={(items) => setMedia((m) => [...m, ...items])} />
          {media.filter((m) => m.kind === "audio").length > 0 && <p className="okBar">Голосовых заметок: {media.filter((m) => m.kind === "audio").length}</p>}
        </div>
      )}

      <div className="nmRows">
        <div className="nmRow col">
          <span className="nmLabel">
            <Icon name="pin" size={20} /> Место
          </span>
          <PlacePicker value={loc} onChange={setLoc} />
        </div>
        <label className="nmRow">
          <span className="nmLabel">
            <Icon name="calendar" size={20} /> Время
          </span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <div className="nmRow col">
          <span className="nmLabel">Описание</span>
          <textarea rows={type === "note" ? 6 : 3} placeholder="Напишите, что запомнилось…" value={text} onChange={(e) => setText(e.target.value)} />
          <input placeholder="Название (необязательно)" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="nmRow">
          <span className="nmLabel">
            <Icon name="clock" size={20} /> Погода (авто)
          </span>
          <span className="nmValue">{weather ? `${weather.icon} ${weather.temp > 0 ? "+" : ""}${weather.temp}° ${weather.label}` : loc && (loc.lat || loc.lon) ? "…" : "по месту и времени"}</span>
        </div>
        <label className="nmRow col">
          <span className="nmLabel">
            <Icon name="route" size={20} /> Куда сохранить
          </span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="event">Отдельное событие (не поездка)</option>
            {(trips ?? [])
              .filter((t) => !isEvent(t) || t.id === preset)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {isEvent(t) ? "Событие" : "Поездка"}: {t.title}
                </option>
              ))}
          </select>
        </label>
      </div>

      {err && <p className="errorBar">{err}</p>}
      <button className="primary wide nmBottomSave" onClick={save} disabled={saving || busyMedia}>
        {saving ? "Сохраняю…" : "Сохранить момент"}
      </button>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { readTakeoutFiles, readTakeoutZip, type TakeoutItem } from "@/lib/takeout";
import { Icon } from "@/components/Icon";
import { readPhotoInfo, localIso } from "@/lib/exif";
import { plural } from "@/lib/format";
import { reverseInfo, type ReverseInfo } from "@/lib/geocode";
import { planImport, type ImportCluster, type ImportFile } from "@/lib/importPlan";
import { addMedia } from "@/lib/media/store";
import { createCheckpoint, newId } from "@/lib/markerStyle";
import { getRepo, newTrip } from "@/lib/repo";
import { routes } from "@/lib/routes";
import { isEvent, momentDate } from "@/lib/stats";
import { useTrips } from "@/lib/useTrips";
import type { Checkpoint, Trip } from "@/lib/types";

const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${RU_MONTHS_GEN[m - 1]} ${y}`;
};

/** Превью: файл из галереи — сразу; из архива — только когда плитка видна на экране. */
function Thumb({ f }: { f: ImportFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (f.kind !== "image") return;
    let u: string | null = null;
    let alive = true;
    const show = (file: File) => {
      if (!alive || !file.type.startsWith("image/") || /heic|heif/i.test(file.type)) return;
      u = URL.createObjectURL(file);
      setUrl(u);
    };
    if (f.file) show(f.file);
    else if (f.load && el.current) {
      const io = new IntersectionObserver((ents) => {
        if (ents.some((x) => x.isIntersecting)) {
          io.disconnect();
          f.load!().then(show).catch(() => undefined);
        }
      });
      io.observe(el.current);
      return () => {
        alive = false;
        io.disconnect();
        if (u) URL.revokeObjectURL(u);
      };
    }
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [f]);
  return (
    <span ref={el} className="impThumbIn">
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="impVideo"><Icon name={f.kind === "video" ? "video" : "photo"} size={18} /></span>}
    </span>
  );
}

const MAX_DAYS_PREVIEW = 40;

type Target = "days" | "trip" | string;

/** Импорт из галереи: много фото и видео сразу, раскладка по дням и местам по дате и GPS снимков. */
export default function ImportPage() {
  const router = useRouter();
  const { trips } = useTrips();
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [reading, setReading] = useState(false);
  const [places, setPlaces] = useState<Record<string, ReverseInfo | null>>({});
  const [target, setTarget] = useState<Target>("days");
  const [tripTitle, setTripTitle] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [year, setYear] = useState("all");
  const [skipped, setSkipped] = useState(0);
  const years = useMemo(() => Array.from(new Set(files.map((f) => f.takenAt.slice(0, 4)))).sort().reverse(), [files]);
  const shown = useMemo(() => (year === "all" ? files : files.filter((f) => f.takenAt.startsWith(year))), [files, year]);
  const days = useMemo(() => planImport(shown), [shown]);
  const clusters = days.flatMap((d) => d.clusters);
  const withGps = shown.filter((f) => f.gps).length;
  const withExif = shown.filter((f) => f.fromExif).length;

  // Названия мест по GPS (по одному запросу в секунду, с кэшем на устройстве).
  useEffect(() => {
    let alive = true;
    for (const c of clusters.slice(0, 60)) {
      if (!c.center || c.key in places) continue;
      reverseInfo(c.center.lat, c.center.lon, 16).then((info) => alive && setPlaces((p) => ({ ...p, [c.key]: info })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters.map((c) => c.key).join("|")]);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    setReading(true);
    const out: ImportFile[] = [];
    for (const file of list) {
      const kind = file.type.startsWith("video/") ? "video" : "image";
      const info = kind === "image" ? await readPhotoInfo(file) : { takenAt: file.lastModified ? localIso(new Date(file.lastModified)) : undefined, fromExif: false, gps: undefined };
      out.push({ key: newId(), file, kind, takenAt: info.takenAt ?? localIso(new Date()), fromExif: info.fromExif, gps: info.gps });
    }
    setFiles((f) => [...f, ...out]);
    setReading(false);
  }

  /** Google Фото через Takeout: .zip архив(ы), распакованная папка или файлы вместе с .json. */
  async function pickTakeout(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    setReading(true);
    setErr(null);
    try {
      const zips = list.filter((f) => /\.zip$/i.test(f.name));
      const rest = list.filter((f) => !/\.zip$/i.test(f.name));
      const items: TakeoutItem[] = [];
      for (const z of zips) items.push(...(await readTakeoutZip(z, setProgress)));
      if (rest.length) items.push(...(await readTakeoutFiles(rest, setProgress)));
      const dated = items.filter((i) => i.takenAt);
      setSkipped((n) => n + items.length - dated.length);
      setFiles((f) => [
        ...f,
        ...dated.map((i) => ({ key: i.key + newId(), load: i.load, name: i.name, kind: i.kind, takenAt: i.takenAt!, fromExif: i.fromMeta || Boolean(i.takenAt), gps: i.gps })),
      ]);
      if (!items.length) setErr("В архиве не нашлось фото или видео.");
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    } finally {
      setProgress(null);
      setReading(false);
    }
  }

  function drop(c: ImportCluster) {
    const keys = new Set(c.files.map((f) => f.key));
    setFiles((f) => f.filter((x) => !keys.has(x.key)));
  }

  const clusterTitle = (c: ImportCluster) => places[c.key]?.place || (c.center ? "Место по GPS" : "Фото");
  /** Подпись места: «Казанский кремль, Казань, Татарстан» — без улицы (она уходит в адрес). */
  const placeLabel = (c: ImportCluster) => {
    const i = places[c.key];
    if (!i) return undefined;
    return Array.from(new Set([i.place, i.city, i.state].filter(Boolean))).join(", ");
  };

  async function run() {
    setErr(null);
    if (!shown.length) return;
    try {
      const repo = await getRepo();
      const ids = new Map<string, string>();
      let n = 0;
      // Файлы сохраняются через обычный механизм: на устройство, затем в облако / на Google Диск.
      for (const f of shown) {
        setProgress(`Сохраняю ${++n} из ${shown.length}…`);
        const file = f.file ?? (await f.load!());
        ids.set(f.key, (await addMedia(file)).id);
      }
      // Названия мест для всех моментов (для больших архивов — по одному в секунду).
      const need = clusters.filter((c) => c.center && !(c.key in places));
      let k = 0;
      for (const c of need) {
        setProgress(`Определяю места: ${++k} из ${need.length}…`);
        places[c.key] = await reverseInfo(c.center!.lat, c.center!.lon, 16).catch(() => null);
      }
      setProgress("Раскладываю по моментам…");
      const toCheckpoint = (c: ImportCluster): Checkpoint => {
        const mediaIds = c.files.map((f) => ids.get(f.key)!).filter(Boolean);
        const info = places[c.key];
        const firstImage = c.files.find((f) => f.kind === "image");
        return createCheckpoint("regular", {
          title: clusterTitle(c),
          time: c.from,
          location: c.center ? { ...c.center, label: placeLabel(c) } : undefined,
          mediaIds,
          coverMediaId: firstImage ? ids.get(firstImage.key) : mediaIds[0],
          meta: { date: c.date, type: c.files.every((f) => f.kind === "video") ? "video" : "photo", ...(info?.label ? { address: info.label } : {}) },
        });
      };

      let openId: string;
      if (target === "days") {
        let firstId = "";
        for (const d of days) {
          const cps = d.clusters.map(toCheckpoint);
          const main = cps.find((c) => c.location?.label);
          const t = newTrip({
            title: main ? main.title : `Фото ${dayLabel(d.date)}`,
            date: d.date,
            time: d.clusters[0].from,
            place: main?.location?.label?.split(",").slice(1).join(",").trim() || undefined,
            checkpoints: cps,
            meta: { kind: "event" },
          });
          await repo.save(t);
          firstId ||= t.id;
        }
        openId = firstId;
      } else if (target === "trip") {
        const cps = clusters.map(toCheckpoint);
        const t = newTrip({
          title: tripTitle.trim() || `Поездка ${dayLabel(days[0].date)}`,
          date: days[0].date,
          checkpoints: cps,
          meta: { kind: "trip", ...(days.length > 1 ? { endDate: days[days.length - 1].date } : {}) },
        });
        await repo.save(t);
        openId = t.id;
      } else {
        const t = await repo.get(target);
        if (!t) throw new Error("Поездка не найдена");
        openId = t.id;
        await repo.save(insertByTime(t, clusters.map(toCheckpoint)));
      }
      router.replace(routes.trip(openId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }

  return (
    <main className="newMoment importPage">
      <header className="nmHead">
        <Link href={routes.newMoment()} className="iconBtnPlain" aria-label="Назад">
          <Icon name="back" />
        </Link>
        <h1>Импорт из галереи</h1>
        <span style={{ width: 40 }} />
      </header>

      <label className="nmDrop impDrop">
        <Icon name="photo" size={34} />
        <span>{reading ? "Читаю даты и места…" : files.length ? "+ Добавить ещё фото и видео" : "Выбрать фото и видео из галереи"}</span>
        <input type="file" accept="image/*,video/*" multiple onChange={pick} />
      </label>

      <div className="takeoutBox">
        <strong>Google Фото (через Google Takeout)</strong>
        <span className="muted small">
          На takeout.google.com выберите «Google Фото» и скачайте архив. Здесь выберите сам .zip (можно несколько) — даты и места возьмутся из описаний Google.
        </span>
        <div className="takeoutBtns">
          <label className="softBtn">
            Архив .zip
            <input type="file" accept=".zip,application/zip,application/x-zip-compressed" multiple hidden onChange={pickTakeout} />
          </label>
          <label className="softBtn">
            Распакованная папка
            <input type="file" multiple hidden onChange={pickTakeout} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          </label>
        </div>
        {reading && progress && <p className="hint">{progress}</p>}
      </div>

      {files.length > 0 && (
        <>
          <p className="hint impHint">
            {shown.length} {plural(shown.length, "файл", "файла", "файлов")} · {days.length} {plural(days.length, "день", "дня", "дней")} · {clusters.length}{" "}
            {plural(clusters.length, "момент", "момента", "моментов")}. Дата съёмки найдена у {withExif}, место — у {withGps}.
            {withGps < shown.length ? " У остальных место можно указать потом в «Редактировать»." : ""}
          </p>

          {years.length > 1 && (
            <div className="yearChips static">
              <button className={year === "all" ? "on" : ""} onClick={() => setYear("all")}>
                Все годы
              </button>
              {years.map((y) => (
                <button key={y} className={year === y ? "on" : ""} onClick={() => setYear(y)}>
                  {y}
                </button>
              ))}
            </div>
          )}
          {skipped > 0 && <p className="hint">Без даты съёмки (пропущены): {skipped}.</p>}
          {days.length > MAX_DAYS_PREVIEW && <p className="hint">Показаны первые {MAX_DAYS_PREVIEW} дней из {days.length} — импортируются все.</p>}
          {days.slice(0, MAX_DAYS_PREVIEW).map((d) => (
            <section key={d.date} className="impDay">
              <h2>
                {dayLabel(d.date)} <span className="muted small">· {d.count}</span>
              </h2>
              {d.clusters.map((c) => (
                <div key={c.key} className="impCluster">
                  <div className="impHead">
                    <Icon name={c.center ? "pin" : "clock"} size={18} />
                    <strong>{clusterTitle(c)}</strong>
                    <span className="muted small">
                      {c.from}
                      {c.to !== c.from ? `–${c.to}` : ""}
                    </span>
                    <button className="iconBtn" aria-label="Убрать из импорта" onClick={() => drop(c)}>
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  {places[c.key]?.label && <p className="muted small impPlace">{places[c.key]!.label}</p>}
                  <div className="impThumbs">
                    {c.files.slice(0, 12).map((f) => (
                      <span key={f.key} className="impThumb">
                        <Thumb f={f} />
                      </span>
                    ))}
                    {c.files.length > 12 && <span className="impThumb more">+{c.files.length - 12}</span>}
                  </div>
                </div>
              ))}
            </section>
          ))}

          <div className="nmRows">
            <label className="nmRow col">
              <span className="nmLabel">
                <Icon name="route" size={20} /> Куда сохранить
              </span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="days">Каждый день — отдельное событие</option>
                <option value="trip">Новая поездка из всех фото</option>
                {(trips ?? [])
                  .filter((t) => !isEvent(t))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      В поездку: {t.title}
                    </option>
                  ))}
              </select>
              {target === "trip" && <input placeholder="Название поездки" value={tripTitle} onChange={(e) => setTripTitle(e.target.value)} />}
            </label>
          </div>

          {err && <p className="errorBar">{err}</p>}
          <button className="primary wide nmBottomSave" onClick={run} disabled={Boolean(progress) || reading}>
            {progress ?? `Импортировать ${shown.length} ${plural(shown.length, "файл", "файла", "файлов")}`}
          </button>
        </>
      )}
    </main>
  );
}

/** Вставляет новые моменты в поездку по дате и времени, не трогая порядок уже существующих. */
function insertByTime(t: Trip, add: Checkpoint[]): Trip {
  const key = (c: Checkpoint) => `${momentDate(t, c)}T${c.time ?? "99:99"}`;
  const list = [...t.checkpoints];
  for (const cp of add) {
    let at = list.length;
    const endIdx = list.findIndex((c) => c.kind === "end");
    if (endIdx >= 0) at = endIdx;
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind === "start") continue;
      if (list[i].kind === "end") break;
      if (key(list[i]) > key(cp)) {
        at = i;
        break;
      }
    }
    list.splice(at, 0, cp);
  }
  return { ...t, checkpoints: list, updatedAt: new Date().toISOString() };
}

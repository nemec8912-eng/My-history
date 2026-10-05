"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, Suspense, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { addDoc, getDocBlob, removeDoc, uploadDoc } from "@/lib/docs";
import { saveFile } from "@/lib/download";
import { newId } from "@/lib/markerStyle";
import { getDriveToken } from "@/lib/media/gdrive";
import { routes } from "@/lib/routes";
import { isEvent } from "@/lib/stats";
import { useTrip } from "@/lib/useTrip";
import { useUserData } from "@/lib/userdata";
import type { Expense, ExpenseCategory, PackItem, Trip, TripDoc } from "@/lib/types";
import { BUILTIN_TEMPLATES, CATEGORIES, rub } from "@/lib/plan";
import { localToday } from "@/lib/format";
import { BackLink } from "@/components/BackLink";

type Tab = "pack" | "money" | "docs";

function Packing({ trip, save }: { trip: Trip; save: (items: PackItem[]) => void }) {
  const items = trip.meta?.packing ?? [];
  const [text, setText] = useState("");
  const { data, update } = useUserData();
  const own = data?.packTemplates ?? [];
  const add = (texts: string[]) => {
    const have = new Set(items.map((i) => i.text.toLowerCase()));
    save([...items, ...texts.filter((t) => t.trim() && !have.has(t.trim().toLowerCase())).map((t) => ({ id: newId(), text: t.trim(), done: false }))]);
  };
  const done = items.filter((i) => i.done).length;
  return (
    <section>
      {items.length > 0 && (
        <div className="packProgress">
          <span>
            Собрано {done} из {items.length}
          </span>
          <i style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="packList">
        {items.map((i) => (
          <li key={i.id} className={i.done ? "done" : ""}>
            <label>
              <input type="checkbox" checked={i.done} onChange={() => save(items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))} />
              <span>{i.text}</span>
            </label>
            <button className="iconBtn" aria-label="Убрать" onClick={() => save(items.filter((x) => x.id !== i.id))}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="rowForm"
        onSubmit={(e) => {
          e.preventDefault();
          add([text]);
          setText("");
        }}
      >
        <input placeholder="Что взять с собой…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="softBtn" disabled={!text.trim()}>
          Добавить
        </button>
      </form>
      <h3 className="meH3">Шаблоны</h3>
      <div className="tagChips">
        {[...BUILTIN_TEMPLATES, ...own].map((t) => (
          <button key={t.id} className="tagChip" onClick={() => add(t.items)}>
            + {t.title}
          </button>
        ))}
      </div>
      {items.length > 0 && (
        <div className="packTools">
          <button
            className="linkBtn"
            onClick={() => {
              const name = prompt("Название шаблона", trip.title);
              if (name) void update((d) => ({ ...d, packTemplates: [...(d.packTemplates ?? []), { id: newId(), title: name, items: items.map((i) => i.text) }] }));
            }}
          >
            Сохранить как свой шаблон
          </button>
          <button className="linkBtn" onClick={() => save(items.map((i) => ({ ...i, done: false })))}>
            Снять все отметки
          </button>
        </div>
      )}
    </section>
  );
}

function Money({ trip, save }: { trip: Trip; save: (e: Expense[]) => void }) {
  const list = trip.meta?.expenses ?? [];
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState<ExpenseCategory>("food");
  const total = list.reduce((s, e) => s + e.amount, 0);
  const byCat = (Object.keys(CATEGORIES) as ExpenseCategory[]).map((c) => ({ c, sum: list.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0) })).filter((x) => x.sum > 0);
  return (
    <section>
      <div className="moneyTotal">
        <span className="muted small">Всего потрачено</span>
        <strong>{rub(total)}</strong>
      </div>
      {byCat.length > 0 && (
        <div className="moneyBar">
          {byCat.map(({ c, sum }) => (
            <i key={c} style={{ width: `${(sum / total) * 100}%`, background: CATEGORIES[c].color }} title={CATEGORIES[c].label} />
          ))}
        </div>
      )}
      <div className="moneyCats">
        {byCat.map(({ c, sum }) => (
          <span key={c}>
            {CATEGORIES[c].icon} {CATEGORIES[c].label}: <b>{rub(sum)}</b>
          </span>
        ))}
      </div>
      <form
        className="moneyForm"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amount.replace(/\s/g, "").replace(",", "."));
          if (!n || n < 0) return;
          save([...list, { id: newId(), title: title.trim() || CATEGORIES[cat].label, amount: n, category: cat, date: localToday() }]);
          setTitle("");
          setAmount("");
        }}
      >
        <select value={cat} onChange={(e) => setCat(e.target.value as ExpenseCategory)}>
          {(Object.keys(CATEGORIES) as ExpenseCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORIES[c].icon} {CATEGORIES[c].label}
            </option>
          ))}
        </select>
        <input placeholder="На что" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Сумма, ₽" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="primary" disabled={!amount.trim()}>
          Добавить
        </button>
      </form>
      <ul className="moneyList">
        {[...list].reverse().map((e) => (
          <li key={e.id}>
            <span>{CATEGORIES[e.category].icon}</span>
            <span className="mlText">
              <strong>{e.title}</strong>
              {e.date && <span className="muted small">{e.date.split("-").reverse().join(".")}</span>}
            </span>
            <b>{rub(e.amount)}</b>
            <button className="iconBtn" aria-label="Удалить" onClick={() => confirm(`Удалить «${e.title}»?`) && save(list.filter((x) => x.id !== e.id))}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Docs({ trip, mutate }: { trip: Trip; mutate: (fn: (d: TripDoc[]) => TripDoc[]) => void }) {
  const docs = trip.meta?.docs ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Документы, сохранённые без сети или до подключения Диска, догружаем в облако.
  useEffect(() => {
    const local = docs.filter((d) => d.provider === "local");
    if (!local.length || !navigator.onLine) return;
    (async () => {
      const updated = await Promise.all(local.map((d) => uploadDoc(d).catch(() => d)));
      if (updated.some((d, i) => d.provider !== local[i].provider)) mutate((cur) => cur.map((d) => updated.find((u) => u.id === d.id) ?? d));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy("Сохраняю…");
    setErr(null);
    try {
      const added: TripDoc[] = [];
      for (const f of files) added.push(await addDoc(f));
      mutate((cur) => [...cur, ...added]);
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    } finally {
      setBusy(null);
    }
  }

  async function open(d: TripDoc) {
    setBusy(d.id);
    try {
      const b = await getDocBlob(d);
      if (!b) throw new Error(d.provider === "gdrive" && !getDriveToken() ? "Подключите Google Диск на этом устройстве (раздел «Я»)" : "Файл недоступен");
      await saveFile(b, d.name, { title: d.name });
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    } finally {
      setBusy(null);
    }
  }

  async function del(d: TripDoc) {
    if (!confirm(`Удалить документ «${d.name}»? Файл будет удалён и с устройства, и из облака (с Google Диска — в его корзину).`)) return;
    await removeDoc(d);
    mutate((cur) => cur.filter((x) => x.id !== d.id));
  }

  return (
    <section>
      <label className="nmDrop docDrop">
        <Icon name="note" size={28} />
        <span>{busy === "Сохраняю…" ? busy : "Добавить билет, бронь, чек (PDF или фото)"}</span>
        <input type="file" accept="application/pdf,image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" multiple onChange={pick} />
      </label>
      {err && <p className="errorBar">{err}</p>}
      <ul className="docList">
        {docs.map((d) => (
          <li key={d.id}>
            <button className="docOpen" onClick={() => open(d)} disabled={busy === d.id}>
              <span className="docIcon">{/pdf/.test(d.mime) ? "📄" : d.mime.startsWith("image/") ? "🖼" : "📎"}</span>
              <span className="docText">
                <strong>{d.name}</strong>
                <span className="muted small">
                  {Math.max(1, Math.round(d.size / 1024))} КБ · {d.provider === "gdrive" ? "Google Диск" : d.provider === "supabase" ? "облако" : "только на этом устройстве"}
                </span>
              </span>
            </button>
            <button className="iconBtn" aria-label="Удалить" onClick={() => del(d)}>
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {docs.length === 0 && <p className="muted small">Документы всегда под рукой — и без интернета.</p>}
    </section>
  );
}

/** Сборы, расходы и документы поездки. */
function Plan() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("trip") ?? undefined;
  const requested = sp.get("tab") as Tab | null;
  const { trip, status, update, error } = useTrip(id);
  if (status === "loading") return <main className="shell"><p className="muted">Загрузка…</p></main>;
  if (!trip)
    return (
      <main className="shell">
        <Link className="backLink" href="/">← На главную</Link>
        <p className="muted" style={{ marginTop: 20 }}>Поездка не найдена.</p>
      </main>
    );
  const setMeta = (patch: Partial<NonNullable<Trip["meta"]>>) => update((cur) => ({ ...cur, meta: { ...cur.meta, ...patch } }));
  // У события нет сборов — только расходы и документы.
  const tabs: { id: Tab; label: string }[] = [
    ...(isEvent(trip) ? [] : [{ id: "pack" as Tab, label: "Сборы" }]),
    { id: "money", label: "Расходы" },
    { id: "docs", label: "Документы" },
  ];
  const tab: Tab = tabs.some((t) => t.id === requested) ? requested! : tabs[0].id;
  return (
    <main className="shell planPage">
      <header className="nmHead">
        <BackLink href={routes.trip(trip.id)} className="iconBtnPlain">
          <Icon name="back" />
        </BackLink>
        <h1>{trip.title}</h1>
        <span style={{ width: 40 }} />
      </header>
      <div className="tabsRow" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => router.replace(routes.plan(trip.id, t.id))}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="errorBar">{error}</p>}
      {tab === "pack" && <Packing trip={trip} save={(packing) => setMeta({ packing })} />}
      {tab === "money" && <Money trip={trip} save={(expenses) => setMeta({ expenses })} />}
      {tab === "docs" && <Docs trip={trip} mutate={(fn) => update((cur) => ({ ...cur, meta: { ...cur.meta, docs: fn(cur.meta?.docs ?? []) } }))} />}
    </main>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <Plan />
    </Suspense>
  );
}

"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Memory = {
  id: string;
  title: string;
  date: string;
  place: string;
  text: string;
  photos: string[];
};

const demo: Memory = {
  id: "demo-zoo",
  title: "Московский зоопарк",
  date: "2026-10-04",
  place: "Москва",
  text: "Поездка в зоопарк. Все фотографии и впечатления хранятся внутри одного события.",
  photos: [],
};

export default function Home() {
  const [memories, setMemories] = useState<Memory[]>([demo]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    date: "2026-10-04",
    place: "",
    text: "",
    photos: [] as string[],
  });

  useEffect(() => {
    const saved = localStorage.getItem("my-history-events");
    if (saved) setMemories(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("my-history-events", JSON.stringify(memories));
  }, [memories]);

  const totalPhotos = useMemo(
    () => memories.reduce((sum, item) => sum + item.photos.length, 0),
    [memories]
  );

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setDraft((current) => ({
          ...current,
          photos: [...current.photos, String(reader.result)],
        }));
      };
      reader.readAsDataURL(file);
    });
    event.target.value = "";
  }

  function saveMemory(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    setMemories((current) => [
      {
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        date: draft.date,
        place: draft.place.trim(),
        text: draft.text.trim(),
        photos: draft.photos,
      },
      ...current.filter((item) => item.id !== "demo-zoo"),
    ]);
    setDraft({ title: "", date: "2026-10-04", place: "", text: "", photos: [] });
    setOpen(false);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Личный дневник</p>
          <h1>Моя история</h1>
        </div>
        <button className="avatar" aria-label="Профиль">Я</button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Твои воспоминания</p>
          <h2>Каждая прогулка — отдельная история</h2>
          <p className="muted">
            Создай одно событие и добавляй в него все фотографии этой поездки.
          </p>
        </div>
        <div className="heroActions"><button className="primary" onClick={() => setOpen(true)}>+ Добавить событие</button><a className="secondaryButton" href="/map">Открыть карту маршрута</a></div>
      </section>

      <section className="stats">
        <div><strong>{memories.length}</strong><span>событий</span></div>
        <div><strong>{totalPhotos}</strong><span>фотографий</span></div>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <h3>Мои события</h3>
          <button className="ghost">Календарь</button>
        </div>

        <div className="timeline">
          {memories.map((item) => (
            <article className="card" key={item.id}>
              <div className="datePill">{new Date(item.date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</div>
              <div className="photoPlaceholder" style={item.photos[0] ? { backgroundImage: `url(${item.photos[0]})` } : undefined}>
                {!item.photos[0] && "Обложка события"}
                {item.photos.length > 0 && <span className="photoCount">{item.photos.length} фото</span>}
              </div>
              <div className="cardBody">
                <p className="place">{item.place || "Место не указано"}</p>
                <h4>{item.title}</h4>
                <p className="muted">{item.text || "Добавь описание воспоминания."}</p>
                {item.photos.length > 1 && (
                  <div className="thumbs">
                    {item.photos.slice(1, 5).map((photo, index) => (
                      <img key={index} src={photo} alt="" />
                    ))}
                    {item.photos.length > 5 && <span>+{item.photos.length - 5}</span>}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {open && (
        <div className="modalBackdrop" onClick={() => setOpen(false)}>
          <form className="composer" onSubmit={saveMemory} onClick={(e) => e.stopPropagation()}>
            <div className="composerHead">
              <div>
                <p className="eyebrow">Новая история</p>
                <h3>Добавить событие</h3>
              </div>
              <button className="close" type="button" onClick={() => setOpen(false)}>×</button>
            </div>

            <label>
              Название прогулки
              <input required placeholder="Например, Московский зоопарк" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <div className="row">
              <label>
                Дата
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label>
                Место
                <input placeholder="Москва" value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} />
              </label>
            </div>
            <label>
              Что запомнилось
              <textarea rows={4} placeholder="Расскажи или позже добавь голосовую заметку..." value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </label>

            <label className="upload">
              + Добавить фотографии
              <input type="file" accept="image/*" multiple onChange={addPhotos} />
            </label>

            {draft.photos.length > 0 && (
              <div className="previewGrid">
                {draft.photos.map((photo, index) => <img src={photo} alt="" key={index} />)}
              </div>
            )}

            <p className="hint">{draft.photos.length} фото выбрано</p>
            <button className="primary wide" type="submit">Сохранить событие</button>
          </form>
        </div>
      )}
    </main>
  );
}

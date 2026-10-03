const memories = [
  {
    date: "4 октября 2026",
    title: "Новая запись",
    place: "Москва",
    text: "Здесь появятся фотографии, голосовые заметки и воспоминания о поездке.",
  },
];

export default function Home() {
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
          <p className="eyebrow">Сегодня</p>
          <h2>Сохраняй моменты, пока они свежие</h2>
          <p className="muted">
            Фото, место, текст и голосовая заметка — всё в одной записи.
          </p>
        </div>
        <button className="primary">+ Добавить событие</button>
      </section>

      <section className="section">
        <div className="sectionTitle">
          <h3>Воспоминания</h3>
          <button className="ghost">Календарь</button>
        </div>

        <div className="timeline">
          {memories.map((item) => (
            <article className="card" key={item.title}>
              <div className="datePill">{item.date}</div>
              <div className="photoPlaceholder" aria-hidden="true">Фото</div>
              <div className="cardBody">
                <p className="place">{item.place}</p>
                <h4>{item.title}</h4>
                <p className="muted">{item.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

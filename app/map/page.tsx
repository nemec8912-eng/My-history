"use client";

import { useEffect, useRef, useState } from "react";
import { load } from "@2gis/mapgl";

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Загружаю карту 2ГИС...");

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_2GIS_MAP_KEY;
    if (!key) {
      setStatus("Ключ 2ГИС ещё не подключён в Vercel");
      return;
    }

    let map: any;

    load()
      .then((mapgl) => {
        if (!containerRef.current) return;
        map = new mapgl.Map(containerRef.current, {
          center: [37.615655, 55.768005],
          zoom: 11,
          key,
        });

        new mapgl.Marker(map, {
          coordinates: [37.615655, 55.768005],
        });

        setStatus("Карта подключена");
      })
      .catch(() => setStatus("Не удалось загрузить карту"));

    return () => {
      if (map) map.destroy();
    };
  }, []);

  return (
    <main className="mapPage">
      <div className="mapTopbar">
        <a className="backLink" href="/">← Назад</a>
        <div>
          <p className="eyebrow">Маршрут поездки</p>
          <h1>Карта 2ГИС</h1>
          <p className="muted">{status}</p>
        </div>
      </div>

      <section className="routeControls">
        <label>
          Откуда
          <input placeholder="Начальная точка" />
        </label>
        <label>
          Куда
          <input placeholder="Конечная точка" />
        </label>
        <button className="primary" type="button">Построить маршрут</button>
      </section>

      <div ref={containerRef} className="mapCanvas" />

      <section className="routeHint">
        <strong>Следующий этап</strong>
        <p className="muted">
          Поверх реального маршрута здесь появятся твои контрольные точки:
          фото-превью, форма, цвет, размер и карточка события.
        </p>
      </section>
    </main>
  );
}

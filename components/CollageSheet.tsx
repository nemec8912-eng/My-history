"use client";

import { useEffect, useRef, useState } from "react";
import { collagePhotoIds, drawCollage, type CollageFormat, type CollageLayout } from "@/lib/collage";
import { saveFile } from "@/lib/download";
import type { Trip } from "@/lib/types";
import { Sheet } from "./Sheet";

/** Коллаж-открытка: выбор сетки и формата, предпросмотр, сохранение/отправка картинки. */
export function CollageSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<CollageLayout>(4);
  const [format, setFormat] = useState<CollageFormat>("post");
  const [busy, setBusy] = useState(true);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    (async () => {
      const ids = await collagePhotoIds(trip, layout);
      if (!alive || !canvas.current) return;
      setCount(ids.length);
      await drawCollage(canvas.current, trip, ids, format);
      if (alive) setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [trip, layout, format]);

  async function save() {
    const c = canvas.current;
    if (!c) return;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (blob) await saveFile(blob, `${trip.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 50) || "коллаж"}.jpg`, { share: true, title: trip.title });
  }

  return (
    <Sheet onClose={onClose}>
      <div className="editor collageSheet">
        <p className="eyebrow">Коллаж</p>
        <div className="segRow">
          {([4, 6, 9] as CollageLayout[]).map((n) => (
            <button key={n} className={layout === n ? "on" : ""} onClick={() => setLayout(n)}>
              {n} фото
            </button>
          ))}
          {(["post", "story"] as CollageFormat[]).map((f) => (
            <button key={f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>
              {f === "post" ? "Пост 4:5" : "Сторис 9:16"}
            </button>
          ))}
        </div>
        <div className={`collagePreview ${format}`}>
          <canvas ref={canvas} />
          {busy && <span className="recapLoading">Собираю…</span>}
        </div>
        {!busy && count < layout && <p className="hint">В поездке пока {count} фото — коллаж собран из них.</p>}
        <div className="editorActions">
          <button className="softBtn" onClick={onClose}>
            Закрыть
          </button>
          <button className="primary" onClick={save} disabled={busy || count === 0}>
            Сохранить / отправить
          </button>
        </div>
      </div>
    </Sheet>
  );
}

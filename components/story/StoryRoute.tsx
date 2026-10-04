"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { layoutStory } from "@/lib/storyLayout";
import type { Checkpoint, Trip } from "@/lib/types";
import { StoryPoint } from "./StoryPoint";
import { StoryRoutePath } from "./StoryRoutePath";

/**
 * Режим «История»: красивый вертикальный путь, построенный из порядка точек.
 * Реальные координаты используются только картой; здесь — визуализация.
 */
export function StoryRoute({
  trip,
  onOpen,
  upward = true,
  preview = false,
}: {
  trip: Trip;
  onOpen: (cp: Checkpoint) => void;
  /** Снизу вверх (по умолчанию) или сверху вниз. */
  upward?: boolean;
  /** Компактный предпросмотр для главного экрана. */
  preview?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [settled, setSettled] = useState(false);

  // Подстраховка: после анимации появления элементы гарантированно видимы.
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 4500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => (width
        ? layoutStory(trip, width, (cp) => Boolean(cp.coverMediaId), { upward, density: preview ? 0.62 : 1, mini: preview })
        : null),
    [trip, width, upward, preview]
  );

  return (
    <div ref={ref} className={`storyRoute ${preview ? "preview" : ""} ${settled ? "settled" : ""}`} style={{ height: layout?.height ?? 320 }}>
      {layout && (
        <>
          <StoryRoutePath layout={layout} />
          {layout.nodes.map((node) => (
            <StoryPoint
              key={node.cp.id}
              node={node}
              width={layout.width}
              labelWidth={layout.labelWidth}
              mini={preview}
              onOpen={onOpen}
            />
          ))}
        </>
      )}
    </div>
  );
}

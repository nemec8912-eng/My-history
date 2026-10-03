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
export function StoryRoute({ trip, onOpen }: { trip: Trip; onOpen: (cp: Checkpoint) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

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
    () => (width ? layoutStory(trip, width, (cp) => Boolean(cp.coverMediaId)) : null),
    [trip, width]
  );

  return (
    <div ref={ref} className="storyRoute" style={{ height: layout?.height ?? 320 }}>
      {layout && (
        <>
          <StoryRoutePath layout={layout} />
          {layout.nodes.map((node) => (
            <StoryPoint
              key={node.cp.id}
              node={node}
              width={layout.width}
              labelWidth={layout.labelWidth}
              onOpen={onOpen}
            />
          ))}
        </>
      )}
    </div>
  );
}

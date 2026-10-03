"use client";

import { formatDuration, minutesOf } from "@/lib/format";
import type { Checkpoint } from "@/lib/types";
import { MediaImg } from "../media/Media";

/** Большая карточка конечной локации под маршрутом. */
export function DestinationCard({ cp, onOpen }: { cp: Checkpoint; onOpen: () => void }) {
  const a = minutesOf(cp.place?.arrivedAt ?? cp.time);
  const b = minutesOf(cp.place?.leftAt);
  const stay = a != null && b != null && b > a ? formatDuration(b - a) : null;
  const moments = cp.place?.moments.length ?? 0;
  return (
    <button type="button" className="destCard" onClick={onOpen} style={{ ["--accent" as string]: cp.style.color }}>
      <div className="destCover">
        {cp.coverMediaId ? <MediaImg id={cp.coverMediaId} variant="original" /> : <span className="destCoverEmpty">★</span>}
        <span className="destBadge">Основная локация</span>
      </div>
      <div className="destBody">
        <h3>{cp.title}</h3>
        <p className="muted">
          {[cp.place?.arrivedAt ?? cp.time, cp.place?.leftAt].filter(Boolean).join(" – ")}
          {stay ? ` · ${stay}` : ""}
        </p>
        {cp.location?.label && <p className="muted small">📍 {cp.location.label}</p>}
        <div className="destStats">
          <span>{cp.mediaIds.length} файлов</span>
          <span>{moments} моментов</span>
        </div>
        <span className="destOpen">Открыть локацию ›</span>
      </div>
    </button>
  );
}

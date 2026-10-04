"use client";

import { TRAVEL } from "@/lib/travel";
import type { Checkpoint } from "@/lib/types";
import { PointMarker, checkpointLabel } from "../PointMarker";

/** Горизонтальная лента пути: все точки по порядку с переходами между ними. */
export function JourneyStrip({ points, onOpen }: { points: Checkpoint[]; onOpen: (cp: Checkpoint) => void }) {
  if (points.length < 2) return null;
  return (
    <div className="journeyStrip" role="list" aria-label="Лента пути">
      {points.map((cp, i) => (
        <div className="jsItem" role="listitem" key={cp.id}>
          {i > 0 && (
            <span
              className={`jsLink ${cp.arrivedBy === "walk" || !cp.arrivedBy ? "dotted" : ""}`}
              style={{ ["--a" as string]: points[i - 1].style.color, ["--b" as string]: cp.style.color }}
            >
              {cp.arrivedBy && <span className="jsMode">{TRAVEL[cp.arrivedBy].icon}</span>}
            </span>
          )}
          <button type="button" className="jsPoint" onClick={() => onOpen(cp)}>
            <PointMarker style={{ ...cp.style, size: "m" }} d={cp.kind === "regular" ? 38 : 44} photoId={cp.style.showPhoto ? cp.coverMediaId : undefined} label={checkpointLabel(cp, i)} glow />
            <span className="jsTitle">{cp.title}</span>
            {cp.time && <span className="jsTime">{cp.time}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { SHAPES, safeColor } from "@/lib/markerStyle";
import type { Checkpoint, MarkerStyle } from "@/lib/types";
import { MediaImg } from "./media/Media";

/**
 * Значок контрольной точки: форма + цвет + размер + (необязательно) фото внутри.
 * Используется и в «Истории», и в редакторе, и в списках.
 */
export function PointMarker({
  style,
  d,
  photoId,
  label,
  className,
  glow,
}: {
  style: MarkerStyle;
  d: number;
  photoId?: string;
  label?: string;
  className?: string;
  glow?: boolean;
}) {
  const shape = SHAPES[style.shape] ?? SHAPES.circle;
  const color = safeColor(style.color);
  const ring = Math.max(2, Math.round(d * 0.07));
  const isTriangle = style.shape === "triangle";
  const wrap: CSSProperties = {
    width: d,
    height: d,
    ["--marker-color" as string]: color,
  };
  return (
    <span className={`pointMarker ${glow ? "glow" : ""} ${className ?? ""}`} style={wrap}>
      <span className="pmLayer" style={{ clipPath: shape.clip, background: photoId ? color : "#fff" }} />
      <span
        className="pmLayer pmInner"
        style={{ clipPath: shape.clip, inset: isTriangle ? ring * 1.8 : ring, background: color }}
      >
        {photoId ? (
          <MediaImg id={photoId} />
        ) : (
          <span className="pmLabel" style={{ fontSize: Math.max(11, d * 0.4), paddingTop: isTriangle ? d * 0.18 : 0 }}>
            {label}
          </span>
        )}
      </span>
    </span>
  );
}

export function checkpointLabel(cp: Checkpoint, index: number): string {
  if (cp.icon) return cp.icon;
  if (cp.kind === "start") return "⌂";
  if (cp.kind === "end") return "★";
  return String(index + 1);
}

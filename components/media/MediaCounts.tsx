"use client";

import { useMediaMetas } from "./useMedia";

/** Счётчики «📷 3 · 🎬 1 · 🎙 2» по типам медиа. */
export function MediaCounts({ ids, className }: { ids: string[]; className?: string }) {
  const metas = useMediaMetas(ids);
  const n = (k: string) => metas.filter((m) => m.kind === k).length;
  const parts: [string, number][] = [
    ["📷", n("image")],
    ["🎬", n("video")],
    ["🎙", n("audio")],
  ];
  const shown = parts.filter(([, c]) => c > 0);
  if (!shown.length) return null;
  return (
    <span className={`mediaCounts ${className ?? ""}`}>
      {shown.map(([icon, c]) => (
        <span key={icon}>
          {icon} {c}
        </span>
      ))}
    </span>
  );
}

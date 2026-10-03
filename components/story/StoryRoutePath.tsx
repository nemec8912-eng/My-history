"use client";

import { useEffect, useId, useRef, useState } from "react";
import { safeColor } from "@/lib/markerStyle";
import type { StoryLayout } from "@/lib/storyLayout";
import { DEFAULT_LINE, TRAVEL } from "@/lib/travel";

/** Извилистая линия маршрута: градиент между цветами соседних точек + плавное «прорисовывание». */
export function StoryRoutePath({ layout }: { layout: StoryLayout }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskPath = useRef<SVGPathElement>(null);
  const animated = useRef(false);
  const segRefs = useRef<(SVGPathElement | null)[]>([]);
  const [mids, setMids] = useState<{ x: number; y: number }[]>([]);

  // Середины участков — там стоит значок способа передвижения.
  useEffect(() => {
    setMids(
      layout.segments.map((_, i) => {
        const p = segRefs.current[i];
        if (!p) return { x: 0, y: 0 };
        const pt = p.getPointAtLength(p.getTotalLength() / 2);
        return { x: pt.x, y: pt.y };
      })
    );
  }, [layout]);

  useEffect(() => {
    const p = maskPath.current;
    if (!p) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animated.current || reduce) {
      p.style.transition = "none";
      p.style.strokeDasharray = "none";
      p.style.strokeDashoffset = "0";
      animated.current = true;
      return;
    }
    animated.current = true;
    const len = p.getTotalLength();
    p.style.transition = "none";
    p.style.strokeDasharray = `${len} ${len}`;
    p.style.strokeDashoffset = `${len}`;
    p.getBoundingClientRect();
    const dur = Math.min(2.6, 0.9 + len / 2200);
    p.style.transition = `stroke-dashoffset ${dur}s cubic-bezier(.45,.05,.25,1)`;
    p.style.strokeDashoffset = "0";
    const t = setTimeout(() => {
      p.style.transition = "none";
      p.style.strokeDasharray = "none";
    }, dur * 1000 + 120);
    return () => clearTimeout(t);
  }, [layout.fullPath]);

  const { width: W, height: H } = layout;
  return (
    <svg className="storyPath" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <defs>
        {layout.segments.map((s, i) => (
          <linearGradient
            key={s.id}
            id={`${uid}g${i}`}
            gradientUnits="userSpaceOnUse"
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2 === s.y1 ? s.y1 + 1 : s.y2}
          >
            <stop offset="0" stopColor={safeColor(s.colorA)} />
            <stop offset="1" stopColor={safeColor(s.colorB)} />
          </linearGradient>
        ))}
        <mask id={`${uid}m`} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
          <path ref={maskPath} d={layout.fullPath} fill="none" stroke="#fff" strokeWidth="40" strokeLinecap="round" />
        </mask>
      </defs>
      <g mask={`url(#${uid}m)`}>
        {layout.segments.map((s, i) => {
          const line = s.mode ? TRAVEL[s.mode].line : DEFAULT_LINE;
          const solid = !line.dash;
          return (
            <g key={s.id}>
              <path d={s.d} fill="none" stroke={`url(#${uid}g${i})`} strokeWidth={solid ? 16 : 14} strokeOpacity="0.12" strokeLinecap="round" />
              {!solid && (
                <path d={s.d} fill="none" stroke={`url(#${uid}g${i})`} strokeWidth="2" strokeOpacity="0.3" strokeLinecap="round" />
              )}
              <path
                ref={(el) => {
                  segRefs.current[i] = el;
                }}
                d={s.d}
                fill="none"
                stroke={`url(#${uid}g${i})`}
                strokeWidth={line.width}
                strokeLinecap="round"
                strokeDasharray={line.dash}
              />
              {s.mode === "train" || s.mode === "metro" ? (
                <path d={s.d} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.6" strokeDasharray="5 7" />
              ) : null}
            </g>
          );
        })}
      </g>
      {layout.segments.map((s, i) =>
        s.mode && mids[i] && mids[i].y ? (
          <g key={`b-${s.id}`} className="travelBadge" transform={`translate(${mids[i].x} ${mids[i].y})`} style={{ animationDelay: `${0.6 + i * 0.08}s` }}>
            <circle r="15" fill="#fff" stroke={safeColor(s.colorB)} strokeWidth="2" />
            <text textAnchor="middle" dominantBaseline="central" fontSize="15">
              {TRAVEL[s.mode].icon}
            </text>
          </g>
        ) : null
      )}
    </svg>
  );
}

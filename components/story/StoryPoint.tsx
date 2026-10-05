"use client";

import type { CSSProperties } from "react";
import type { StoryNode } from "@/lib/storyLayout";
import type { Checkpoint } from "@/lib/types";
import { MediaImg } from "../media/Media";
import { MediaCounts } from "../media/MediaCounts";
import { TRAVEL } from "@/lib/travel";
import { PointMarker, checkpointLabel } from "../PointMarker";

export function StoryPointMarker({ node }: { node: StoryNode }) {
  const { cp, d, photoMarker, index } = node;
  return (
    <PointMarker
      style={cp.style}
      d={d}
      photoId={photoMarker ? cp.coverMediaId : undefined}
      label={checkpointLabel(cp, index)}
      glow={cp.kind === "end" || cp.importance >= 2}
    />
  );
}

/** Карточка рядом с точкой: номер, название, время, описание и маленькое фото. */
export function StoryPointPreview({
  node,
  style,
  onOpen,
  mini,
}: {
  node: StoryNode;
  style: CSSProperties;
  onOpen: () => void;
  mini?: boolean;
}) {
  const { cp, index, photoMarker, side } = node;
  const thumb = !photoMarker && cp.coverMediaId;
  const isEnd = cp.kind === "end";
  const subtitle = isEnd && cp.place ? "Основная локация" : cp.description || cp.location?.label;
  const count = cp.mediaIds.length;
  if (mini) {
    return (
      <button type="button" className={`storyCard mini ${side} ${isEnd ? "end" : ""}`} style={style} onClick={onOpen}>
        <span className="storyCardText">
          <span className="storyCardTitle">
            <span className="storyNum" style={{ color: cp.style.color }}>{index + 1}.</span> {cp.title || "Без названия"}
          </span>
          {cp.time && <span className="storyTime">{cp.time}</span>}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`storyCard premium ${side} ${isEnd ? "end" : ""} ${cp.importance >= 2 ? "important" : ""}`}
      style={{ ...style, ["--pc" as string]: cp.style.color }}
      onClick={onOpen}
    >
      <span className="scAccent" aria-hidden />
      <span className="storyCardText">
        <span className="scTop">
          <span className="scNum">{index + 1}</span>
          {cp.time && <span className="scTime">{cp.time}</span>}
          {cp.importance >= 2 && <span className="scStar" title="Важная точка">★</span>}
        </span>
        <span className="storyCardTitle">{cp.title || "Без названия"}</span>
        {subtitle && <span className="storyDesc">{subtitle}</span>}
        {(cp.arrivedBy || count > 0) && (
          <span className="scMeta">
            {cp.arrivedBy && (
              <span className="scTag">
                {TRAVEL[cp.arrivedBy].icon} {TRAVEL[cp.arrivedBy].label}
              </span>
            )}
            {count > 0 && <MediaCounts ids={cp.mediaIds} />}
          </span>
        )}
      </span>
      {thumb && (
        <span className="scThumb">
          <MediaImg id={cp.coverMediaId} />
        </span>
      )}
      {isEnd && <span className="storyChevron">›</span>}
    </button>
  );
}

export function StoryPoint({
  node,
  width,
  labelWidth,
  onOpen,
  mini,
}: {
  node: StoryNode;
  width: number;
  labelWidth: number;
  onOpen: (cp: Checkpoint) => void;
  mini?: boolean;
}) {
  const { x, y, d, side, cp } = node;
  const delay = { animationDelay: `${0.25 + Math.min(node.index, 30) * 0.08}s` };
  const cardStyle: CSSProperties =
    side === "right"
      ? { left: x + d / 2 + 10, top: y, width: labelWidth, ...delay }
      : { right: width - (x - d / 2 - 10), top: y, width: labelWidth, ...delay };
  return (
    <>
      <button
        type="button"
        className={`storyMarker ${cp.kind}`}
        style={{ left: x, top: y, ...delay }}
        onClick={() => onOpen(cp)}
        aria-label={cp.title || "Точка маршрута"}
      >
        <StoryPointMarker node={node} />
      </button>
      <StoryPointPreview node={node} style={cardStyle} onOpen={() => onOpen(cp)} mini={mini} />
    </>
  );
}

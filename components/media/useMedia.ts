"use client";

import { useEffect, useState } from "react";
import { getMediaMeta, getMediaUrl, type Variant } from "@/lib/media/store";
import type { MediaItem } from "@/lib/types";

export function useMediaUrl(id: string | undefined, variant: Variant = "thumb"): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!id) return;
    getMediaUrl(id, variant).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [id, variant]);
  return url;
}

/** Метаданные медиа (тип файла). Если метаданных нет — считаем файл фотографией. */
export function useMediaMetas(ids: string[]): MediaItem[] {
  const key = ids.join(",");
  const [metas, setMetas] = useState<MediaItem[]>([]);
  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",") : [];
    Promise.all(
      list.map(async (id): Promise<MediaItem> => {
        const meta = await getMediaMeta(id).catch(() => null);
        return meta ?? { id, kind: "image", mime: "image/jpeg", size: 0, createdAt: "" };
      })
    ).then((res) => {
      if (alive) setMetas(res);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return metas;
}

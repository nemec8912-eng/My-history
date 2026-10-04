"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getMediaMeta, getMediaUrl, onMediaChange, type Variant } from "@/lib/media/store";
import { getUpload, onUploadChange, uploadsVersion, type UploadState } from "@/lib/media/uploadState";
import type { MediaItem } from "@/lib/types";

/** Счётчик, который растёт, когда у одного из файлов обновились метаданные/превью. */
function useMediaVersion(ids: string[]): number {
  const key = ids.join(",");
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!key) return;
    const set = new Set(key.split(","));
    return onMediaChange((id) => {
      if (set.has(id)) setV((x) => x + 1);
    });
  }, [key]);
  return v;
}

export function useMediaUrl(id: string | undefined, variant: Variant = "thumb"): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const version = useMediaVersion(id ? [id] : []);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    // При обновлении (version > 0) не мигаем пустым местом — заменяем, когда новый адрес готов.
    if (version === 0) setUrl(null);
    getMediaUrl(id, variant).then((u) => {
      if (alive && (u || version === 0)) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [id, variant, version]);
  return url;
}

/** Метаданные медиа (тип файла). Если метаданных нет — считаем файл фотографией. */
export function useMediaMetas(ids: string[]): MediaItem[] {
  const key = ids.join(",");
  const [metas, setMetas] = useState<MediaItem[]>([]);
  const version = useMediaVersion(ids);
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
  }, [key, version]);
  return metas;
}

/** Состояние загрузки файла (для видео): фаза и реальный прогресс. */
export function useUpload(id: string | undefined): UploadState | undefined {
  useSyncExternalStore(onUploadChange, uploadsVersion, () => 0);
  return getUpload(id);
}

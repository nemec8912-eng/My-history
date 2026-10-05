"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";
import { MediaGallery } from "@/components/media/Media";
import { routes } from "@/lib/routes";
import { plural } from "@/lib/format";
import { useUserData } from "@/lib/userdata";
import { BackLink } from "@/components/BackLink";

function AlbumView() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { data, update } = useUserData();
  const album = data?.albums?.find((a) => a.id === id);
  if (data === null) return <main className="shell"><p className="muted">Загрузка…</p></main>;
  if (!album)
    return (
      <main className="shell">
        <Link className="backLink" href={routes.albums}>← Альбомы</Link>
        <p className="muted" style={{ marginTop: 20 }}>Альбом не найден.</p>
      </main>
    );
  const patch = (fn: (ids: string[]) => string[], title?: string) =>
    update((d) => ({ ...d, albums: (d.albums ?? []).map((a) => (a.id === album.id ? { ...a, title: title ?? a.title, mediaIds: fn(a.mediaIds) } : a)) }));
  return (
    <main className="shell albumPage">
      <header className="nmHead">
        <BackLink href={routes.albums} className="iconBtnPlain">
          <Icon name="back" />
        </BackLink>
        <h1>{album.title}</h1>
        <button
          className="iconBtnPlain"
          aria-label="Переименовать"
          onClick={() => {
            const t = prompt("Название альбома", album.title);
            if (t?.trim()) void patch((x) => x, t.trim());
          }}
        >
          <Icon name="edit" />
        </button>
      </header>
      <p className="muted small">{album.mediaIds.length} {plural(album.mediaIds.length, "файл", "файла", "файлов")} · добавляйте фото кнопкой «В альбом» при просмотре.</p>
      <MediaGallery
        ids={album.mediaIds}
        onRemove={(mid) => void patch((x) => x.filter((m) => m !== mid))}
        removeText="Убрать из альбома? Фото останется в своём моменте."
        empty="В альбоме пока пусто."
      />
      <button
        className="linkBtn danger"
        style={{ marginTop: 20 }}
        onClick={async () => {
          if (!confirm(`Удалить альбом «${album.title}»? Сами фото останутся в своих моментах.`)) return;
          await update((d) => ({ ...d, albums: (d.albums ?? []).filter((a) => a.id !== album.id) }));
          router.replace(routes.albums);
        }}
      >
        Удалить альбом
      </button>
    </main>
  );
}

export default function AlbumPage() {
  return (
    <Suspense fallback={null}>
      <AlbumView />
    </Suspense>
  );
}

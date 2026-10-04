"use client";

import Link from "next/link";
import { TabScreen } from "@/components/BottomNav";
import { MediaImg } from "@/components/media/Media";
import { MomentsTabs } from "@/components/MomentsTabs";
import { newId } from "@/lib/markerStyle";
import { routes } from "@/lib/routes";
import { useUserData } from "@/lib/userdata";

/** Свои альбомы: подборки фото и видео из разных поездок. */
export default function AlbumsPage() {
  const { data, update } = useUserData();
  const albums = data?.albums ?? [];
  const create = () => {
    const title = prompt("Название альбома", "Лучшее лета");
    if (!title?.trim()) return;
    void update((d) => ({ ...d, albums: [...(d.albums ?? []), { id: newId(), title: title.trim(), mediaIds: [], createdAt: new Date().toISOString() }] }));
  };
  return (
    <TabScreen className="albumsPage">
      <header className="appHeader">
        <span className="ahSide" />
        <h1>Моменты</h1>
        <span className="ahSide right" />
      </header>
      <MomentsTabs active="albums" />
      <button className="softBtn wide" onClick={create}>
        + Новый альбом
      </button>
      {data && albums.length === 0 && <p className="muted" style={{ marginTop: 14 }}>Создайте альбом и добавляйте в него фото кнопкой «В альбом» при просмотре фото.</p>}
      <div className="albumGrid">
        {albums.map((a) => (
          <Link key={a.id} className="albumCard" href={routes.album(a.id)}>
            <span className="albumCover">
              {a.mediaIds.slice(0, 4).map((id) => (
                <MediaImg key={id} id={id} />
              ))}
              {a.mediaIds.length === 0 && <span className="albumEmpty">📁</span>}
            </span>
            <strong>{a.title}</strong>
            <span className="muted small">{a.mediaIds.length} файлов</span>
          </Link>
        ))}
      </div>
    </TabScreen>
  );
}

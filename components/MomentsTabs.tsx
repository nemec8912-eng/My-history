"use client";

import Link from "next/link";
import { routes } from "@/lib/routes";

/** Переключатель раздела «Моменты»: хронология · фото · видео. */
export function MomentsTabs({ active }: { active: "timeline" | "photos" | "videos" | "albums" }) {
  const tabs = [
    { id: "timeline", label: "Хронология", href: routes.timeline },
    { id: "photos", label: "Фото", href: routes.photos },
    { id: "videos", label: "Видео", href: routes.videos },
    { id: "albums", label: "Альбомы", href: routes.albums },
  ];
  return (
    <div className="segTabs">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} className={active === t.id ? "on" : ""}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountPanel } from "@/components/AccountSheet";
import { TabScreen } from "@/components/BottomNav";
import { useDriveState } from "@/components/DriveSection";
import { Icon } from "@/components/Icon";
import { routes } from "@/lib/routes";
import { getUserId, isCloudConfigured } from "@/lib/supabase";

/** Раздел «Я»: аккаунт, Google Диск, место, синхронизация (экран 10 макета). */
export default function MePage() {
  const [user, setUser] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const drive = useDriveState();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    getUserId().then(setUser);
  }, [tick]);

  const rows = [
    {
      icon: "sync",
      label: "Синхронизация",
      value: user ? "Включена" : isCloudConfigured() ? "Войдите в аккаунт" : "Только на устройстве",
    },
    {
      icon: "photo",
      label: "Качество загрузки",
      value: drive.enabled ? "Оригинальное" : "Сжатое (облако)",
    },
    {
      icon: "cloud",
      label: "Ожидают загрузки на Диск",
      value: drive.pending ? String(drive.pending) : "Нет",
    },
  ];

  return (
    <TabScreen className="mePage">
      <header className="appHeader">
        <span className="ahSide" />
        <h1>Я</h1>
        <span className="ahSide right" />
      </header>
      <div className="settingsList" style={{ visibility: mounted ? "visible" : "hidden" }}>
        {(mounted ? rows : []).map((r) => (
          <div key={r.label} className="settingsRow">
            <Icon name={r.icon} size={20} />
            <span>{r.label}</span>
            <span className="srValue">{r.value}</span>
          </div>
        ))}
      </div>
      <div className="settingsList meLinks">
        {[
          { href: routes.stats, icon: "map", label: "Статистика и регионы" },
          { href: routes.importPhotos, icon: "grid", label: "Импорт из галереи" },
          { href: routes.trash, icon: "trash", label: "Корзина" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="settingsRow">
            <Icon name={l.icon} size={20} />
            <span>{l.label}</span>
            <Icon name="chevron" size={16} className="srValue" />
          </Link>
        ))}
      </div>
      <div className="meCard">
        <AccountPanel onChanged={() => setTick((t) => t + 1)} />
      </div>
    </TabScreen>
  );
}

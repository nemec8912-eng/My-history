"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { routes } from "@/lib/routes";
import { Icon } from "./Icon";

const TABS = [
  { href: routes.home, icon: "home", label: "Главная", match: (p: string) => p === "/" },
  { href: routes.map, icon: "map", label: "Карта", match: (p: string) => p.startsWith("/map") },
  { href: routes.newMoment(), icon: "plus", label: "", match: () => false, fab: true },
  { href: routes.timeline, icon: "moments", label: "Моменты", match: (p: string) => /^\/(timeline|photos|videos)/.test(p) },
  { href: routes.me, icon: "user", label: "Я", match: (p: string) => p.startsWith("/me") },
];

/** Нижняя навигация как на макете: Главная · Карта · ＋ · Моменты · Я. */
export function BottomNav() {
  const raw = usePathname() || "/";
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const path = (base && raw.startsWith(base) ? raw.slice(base.length) : raw) || "/";
  return (
    <nav className="bottomNav" aria-label="Навигация">
      {TABS.map((t) =>
        t.fab ? (
          <Link key="fab" href={t.href} className="navFab" aria-label="Новый момент">
            <Icon name="plus" size={28} stroke={2.4} />
          </Link>
        ) : (
          <Link key={t.label} href={t.href} className={`navItem ${t.match(path) ? "on" : ""}`}>
            <Icon name={t.icon} size={23} />
            <span>{t.label}</span>
          </Link>
        )
      )}
    </nav>
  );
}

/** Обёртка экрана с нижней навигацией. */
export function TabScreen({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <>
      <main className={`tabScreen ${className ?? ""}`}>{children}</main>
      <BottomNav />
    </>
  );
}

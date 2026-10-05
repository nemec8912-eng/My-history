"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const KEY = "nav-depth";

/** Считает переходы внутри приложения — чтобы «Назад» возвращал туда, откуда пришли. */
export function NavTracker() {
  const path = usePathname();
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, String(Number(sessionStorage.getItem(KEY) || 0) + 1));
    } catch {
      /* ничего */
    }
  }, [path]);
  return null;
}

/**
 * «Назад»: если внутри приложения есть куда вернуться — возвращает на предыдущий экран
 * (например, в хронологию или поиск), иначе ведёт на fallback (открыли по ссылке / из напоминания).
 */
export function BackLink({ href, className, children, label = "Назад" }: { href: string; className?: string; children: React.ReactNode; label?: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      className={className}
      aria-label={label}
      onClick={(e) => {
        let depth = 0;
        try {
          depth = Number(sessionStorage.getItem(KEY) || 0);
        } catch {
          /* ничего */
        }
        if (depth > 1 && window.history.length > 1) {
          e.preventDefault();
          try {
            sessionStorage.setItem(KEY, String(depth - 2)); // возврат тоже засчитается трекером
          } catch {
            /* ничего */
          }
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}

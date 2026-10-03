"use client";

import { ReactNode, useEffect, useState } from "react";

/** Нижний лист на телефоне / модальное окно на ПК. Блокирует прокрутку страницы под собой. */
export function Sheet({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  // Подстраховка: если анимация появления не запустилась, через 450 мс окно показывается без неё.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 450);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className={`modalBackdrop ${settled ? "settled" : ""}`} onClick={onClose}>
      <div className={`sheet ${wide ? "wide" : ""} ${settled ? "settled" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <span className="sheetGrip" aria-hidden />
        <button type="button" className="close sheetClose" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

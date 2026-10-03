"use client";

import { ReactNode, useEffect } from "react";

/** Нижний лист на телефоне / модальное окно на ПК. Блокирует прокрутку страницы под собой. */
export function Sheet({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
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
    <div className="modalBackdrop" onClick={onClose}>
      <div className={`sheet ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <span className="sheetGrip" aria-hidden />
        <button type="button" className="close sheetClose" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

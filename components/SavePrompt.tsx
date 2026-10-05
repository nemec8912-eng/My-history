"use client";

import { useEffect, useState } from "react";
import { onPendingSave, saveFileNow } from "@/lib/download";

/** «Файл готов — сохранить»: появляется, когда подготовка файла заняла время и iPhone требует нового нажатия. */
export function SavePrompt() {
  const [p, setP] = useState<Parameters<typeof saveFileNow>[0] | null>(null);
  useEffect(() => onPendingSave(setP), []);
  if (!p) return null;
  return (
    <div className="savePrompt" role="dialog" aria-label="Файл готов">
      <span>
        Готово: <b>{p.name}</b>
      </span>
      <button
        className="primary"
        onClick={async () => {
          const cur = p;
          setP(null);
          await saveFileNow(cur);
        }}
      >
        Сохранить / отправить
      </button>
      <button className="iconBtn" aria-label="Закрыть" onClick={() => setP(null)}>
        ×
      </button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { getRepo } from "@/lib/repo";
import { allTags, normTag } from "@/lib/tags";

/** Все метки пользователя — для подсказок при вводе. */
export function useAllTags(): string[] {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    getRepo()
      .then((r) => r.list())
      .then((t) => setTags(allTags(t).map((x) => x.tag)))
      .catch(() => undefined);
  }, []);
  return tags;
}

/** Ввод меток: «рыбалка», «дача»… Enter или запятая добавляют метку; есть подсказки из уже существующих. */
export function TagInput({ value, onChange, suggestions = [] }: { value: string[]; onChange: (tags: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(/[,;]/).map(normTag).filter(Boolean);
    if (!parts.length) return;
    onChange(Array.from(new Set([...value, ...parts])));
    setText("");
  };
  const hints = suggestions.filter((s) => !value.includes(s) && (!text || s.startsWith(normTag(text)))).slice(0, 8);
  return (
    <div className="tagInput">
      <div className="tagChips">
        {value.map((t) => (
          <button type="button" key={t} className="tagChip on" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Убрать метку ${t}`}>
            #{t} <span aria-hidden>×</span>
          </button>
        ))}
        <input
          value={text}
          placeholder={value.length ? "+ метка" : "Метки: рыбалка, дача…"}
          onChange={(e) => (/[,;]$/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => add(text)}
          enterKeyHint="done"
        />
      </div>
      {hints.length > 0 && (
        <div className="tagChips hints">
          {hints.map((t) => (
            <button type="button" key={t} className="tagChip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ряд меток для фильтра (хронология, карта, поиск, фото). */
export function TagFilter({ tags, value, onChange }: { tags: { tag: string; count: number }[]; value: string | null; onChange: (t: string | null) => void }) {
  if (!tags.length) return null;
  return (
    <div className="tagFilter" role="toolbar" aria-label="Фильтр по меткам">
      <button className={`tagChip ${value ? "" : "on"}`} onClick={() => onChange(null)}>
        Все
      </button>
      {tags.map(({ tag, count }) => (
        <button key={tag} className={`tagChip ${value === tag ? "on" : ""}`} onClick={() => onChange(value === tag ? null : tag)}>
          #{tag} <em>{count}</em>
        </button>
      ))}
    </div>
  );
}

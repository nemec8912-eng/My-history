"use client";

export const MOODS = ["😍", "🤩", "😊", "😌", "😂", "😮", "🥹", "😴", "😢", "😤", "🥶", "🥵"];
/** Радостные настроения — для фильтра «Лучшее». */
export const HAPPY = new Set(["😍", "🤩", "😊", "😂", "🥹"]);

/** Настроение момента: одно эмодзи, повторное касание снимает. */
export function MoodPicker({ value, onChange }: { value?: string; onChange: (m: string | undefined) => void }) {
  return (
    <div className="moodPicker" role="radiogroup" aria-label="Настроение">
      {MOODS.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} className={value === m ? "on" : ""} onClick={() => onChange(value === m ? undefined : m)}>
          {m}
        </button>
      ))}
    </div>
  );
}

/** Оценка поездки 1–5 звёзд. */
export function StarRating({ value, onChange, size = 26 }: { value?: number; onChange?: (v: number | undefined) => void; size?: number }) {
  return (
    <span className="stars" aria-label={value ? `Оценка ${value} из 5` : "Без оценки"} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" className={n <= (value ?? 0) ? "on" : ""} onClick={() => onChange(value === n ? undefined : n)} aria-label={`${n} из 5`}>
            ★
          </button>
        ) : (
          <i key={n} className={n <= (value ?? 0) ? "on" : ""}>★</i>
        )
      )}
    </span>
  );
}

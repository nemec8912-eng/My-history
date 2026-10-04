/** Погода на дату и время момента. Open-Meteo: бесплатно, без ключа, работает из браузера. */
import type { Weather } from "./types";

const CODES: [number[], string, string][] = [
  [[0], "Ясно", "☀️"],
  [[1], "Малооблачно", "🌤"],
  [[2], "Переменная облачность", "⛅"],
  [[3], "Пасмурно", "☁️"],
  [[45, 48], "Туман", "🌫"],
  [[51, 53, 55, 56, 57], "Морось", "🌦"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Дождь", "🌧"],
  [[71, 73, 75, 77, 85, 86], "Снег", "🌨"],
  [[95, 96, 99], "Гроза", "⛈"],
];

export function describeWeather(code: number): { label: string; icon: string } {
  const hit = CODES.find(([codes]) => codes.includes(code));
  return hit ? { label: hit[1], icon: hit[2] } : { label: "—", icon: "🌡" };
}

/** Возвращает погоду в указанный час (или null, если данных нет). */
export async function fetchWeather(lat: number, lon: number, date: string, time?: string): Promise<Weather | null> {
  if (!lat && !lon) return null;
  const day = new Date(date + "T12:00:00");
  if (Number.isNaN(day.getTime())) return null;
  const ageDays = (Date.now() - day.getTime()) / 86_400_000;
  if (ageDays < -15) return null; // слишком далеко в будущем
  const base =
    ageDays > 5
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "temperature_2m,weather_code",
    start_date: date,
    end_date: date,
    timezone: "auto",
  });
  try {
    const res = await fetch(`${base}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const temps: number[] = data?.hourly?.temperature_2m ?? [];
    const codes: number[] = data?.hourly?.weather_code ?? [];
    if (!temps.length) return null;
    const hour = Math.min(23, Math.max(0, Number((time ?? "13:00").slice(0, 2)) || 13));
    const temp = temps[hour] ?? temps[12];
    const code = codes[hour] ?? codes[12] ?? 0;
    if (temp == null) return null;
    return { temp: Math.round(temp), code, ...describeWeather(code) };
  } catch {
    return null;
  }
}

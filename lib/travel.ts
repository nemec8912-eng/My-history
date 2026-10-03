/**
 * Способы передвижения между точками. Чтобы добавить новый — добавьте ключ сюда
 * и в TravelMode (lib/types.ts). Стиль линии задаётся здесь же.
 */
import type { TravelMode } from "./types";

export type LineStyle = {
  /** stroke-dasharray, undefined = сплошная линия. */
  dash?: string;
  width: number;
};

export const TRAVEL: Record<TravelMode, { label: string; icon: string; line: LineStyle }> = {
  walk: { label: "Пешком", icon: "🚶", line: { dash: "0.1 11", width: 5.5 } },
  bike: { label: "Велосипед", icon: "🚲", line: { dash: "14 9", width: 4.5 } },
  train: { label: "Электричка", icon: "🚆", line: { width: 6 } },
  metro: { label: "Метро", icon: "🚇", line: { width: 6 } },
  bus: { label: "Автобус", icon: "🚌", line: { dash: "22 7", width: 5 } },
  tram: { label: "Трамвай", icon: "🚋", line: { dash: "22 7", width: 5 } },
  taxi: { label: "Такси", icon: "🚕", line: { width: 5 } },
  car: { label: "Машина", icon: "🚗", line: { width: 5 } },
  plane: { label: "Самолёт", icon: "✈️", line: { dash: "3 9", width: 3.5 } },
  boat: { label: "Теплоход", icon: "⛴", line: { dash: "18 6 3 6", width: 4.5 } },
};

export const TRAVEL_IDS = Object.keys(TRAVEL) as TravelMode[];

/** Стиль по умолчанию, если способ не указан: точечная линия, как раньше. */
export const DEFAULT_LINE: LineStyle = { dash: "0.1 11", width: 5.5 };

/** Сборы и расходы: встроенные шаблоны, категории, суммы. */
import type { ExpenseCategory, Trip } from "./types";

export const BUILTIN_TEMPLATES: { id: string; title: string; items: string[] }[] = [
  { id: "sea", title: "🏖 Море", items: ["Паспорт", "Билеты", "Купальник / плавки", "Солнцезащитный крем", "Очки от солнца", "Панама", "Шлёпанцы", "Полотенце", "Зарядка", "Аптечка"] },
  { id: "dacha", title: "🏡 Дача", items: ["Ключи", "Продукты", "Средство от комаров", "Рабочая одежда", "Перчатки", "Зарядка", "Фонарик"] },
  { id: "hike", title: "🥾 Поход", items: ["Палатка", "Спальник", "Коврик", "Горелка и газ", "Котелок", "Вода", "Фонарик", "Аптечка", "Дождевик", "Спички", "Нож", "Пауэрбанк"] },
  { id: "city", title: "🏙 Город", items: ["Паспорт", "Билеты", "Бронь жилья", "Удобная обувь", "Зарядка", "Пауэрбанк", "Зонт"] },
  { id: "winter", title: "❄️ Зима", items: ["Термобельё", "Шапка", "Варежки", "Тёплые носки", "Термос", "Крем для лица", "Грелки для рук"] },
];

export const CATEGORIES: Record<ExpenseCategory, { label: string; icon: string; color: string }> = {
  road: { label: "Дорога", icon: "🚆", color: "#2f7bff" },
  stay: { label: "Жильё", icon: "🛏", color: "#9b6bff" },
  food: { label: "Еда", icon: "🍽", color: "#ff8a1f" },
  fun: { label: "Развлечения", icon: "🎟", color: "#16c79a" },
  shop: { label: "Покупки", icon: "🛍", color: "#e0459b" },
  other: { label: "Другое", icon: "💳", color: "#8f98aa" },
};

export const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
export const tripSpent = (t: Trip) => (t.meta?.expenses ?? []).reduce((s, e) => s + e.amount, 0);


/**
 * Доменная модель приложения «Моя история».
 *
 * ВАЖНО: эти типы не зависят ни от 2ГИС, ни от Google Drive, ни от Supabase.
 * Координаты, порядок точек, оформление и ссылки на медиа — собственные данные
 * приложения. Картографический сервис используется только для отображения
 * и построения маршрута, а результат маршрута сохраняется в нейтральном виде.
 */

/** Внутренний ID медиафайла приложения. Никогда не является ссылкой на Google Drive. */
export type MediaId = string;

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type Location = GeoPoint & {
  /** Человекочитаемый адрес или название места. */
  label?: string;
};

/* ───────────── Оформление контрольных точек ───────────── */

/** Список форм расширяется добавлением ключа в SHAPES (lib/markerStyle.ts). */
export type ShapeId = "circle" | "square" | "triangle" | "diamond" | "star" | "hexagon";

export type SizeId = "s" | "m" | "l" | "xl";

export type MarkerStyle = {
  shape: ShapeId;
  /** Любой CSS-цвет, выбирается пользователем. Цвет не привязан к форме. */
  color: string;
  size: SizeId;
  /** Показывать подпись рядом со значком на карте. */
  showLabel: boolean;
  /** Показывать фото-превью внутри значка. */
  showPhoto: boolean;
};

export type CheckpointKind = "start" | "end" | "regular";

/** Мини-событие внутри большой локации («покормили жирафа», «обед в кафе»). */
export type Moment = {
  id: string;
  title: string;
  time?: string;
  description?: string;
  mediaIds: MediaId[];
};

/** Расширенная страница места: «Московский зоопарк». */
export type PlaceDetails = {
  arrivedAt?: string;
  leftAt?: string;
  moments: Moment[];
};

export type Checkpoint = {
  id: string;
  kind: CheckpointKind;
  title: string;
  /** Короткий значок внутри маркера (эмодзи), необязательно. */
  icon?: string;
  description?: string;
  /** Время в формате HH:MM. */
  time?: string;
  location?: Location;
  style: MarkerStyle;
  /** 0 — обычный этап, 3 — очень важное воспоминание. Значение задаёт пользователь. */
  importance: number;
  coverMediaId?: MediaId;
  mediaIds: MediaId[];
  /** Если задано — точка является «большой локацией» со своей страницей. */
  place?: PlaceDetails;
};

/* ───────────── Маршрут ───────────── */

export type TransportMode = "car" | "taxi" | "pedestrian" | "public";

/** Участок маршрута в нейтральном формате (не формат 2ГИС). */
export type RouteSegment = {
  kind: "walk" | "drive" | "transit" | "transfer";
  /** «Метро», «Электричка», «Автобус»… */
  transport?: string;
  /** Номера/названия линий: «Кольцевая», «М2». */
  lines?: string[];
  lineColor?: string;
  /** Названия станций/остановок по пути. */
  stops?: string[];
  from?: string;
  to?: string;
  distance?: number;
  duration?: number;
  /** Ломаные линии [lon, lat]. */
  path: [number, number][][];
};

export type RouteData = {
  mode: TransportMode;
  from: Location;
  to: Location;
  distance: number;
  duration: number;
  transfers?: number;
  segments: RouteSegment[];
  /** Какой сервис построил маршрут — только для справки. */
  provider: string;
  builtAt: string;
};

/* ───────────── Поездка ───────────── */

export type Trip = {
  id: string;
  title: string;
  date: string;
  time?: string;
  place?: string;
  description?: string;
  coverMediaId?: MediaId;
  mediaIds: MediaId[];
  route?: RouteData;
  /** Порядок массива = порядок точек маршрута. */
  checkpoints: Checkpoint[];
  createdAt: string;
  updatedAt: string;
};

/* ───────────── Медиа ───────────── */

export type MediaKind = "image" | "video" | "audio";

export type MediaItem = {
  id: MediaId;
  kind: MediaKind;
  mime: string;
  name?: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
};

/**
 * Доменная модель приложения «Моя история».
 *
 * ВАЖНО: эти типы не зависят ни от картографических сервисов, ни от Google Drive, ни от Supabase.
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

/** Как добрались до точки от предыдущей. Набор и стили — в lib/travel.ts. */
export type TravelMode = "walk" | "bike" | "train" | "metro" | "bus" | "tram" | "taxi" | "car" | "plane" | "boat";

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

/** Погода в момент события (сохраняется один раз, источник — Open-Meteo). */
export type Weather = {
  temp: number;
  code: number;
  label: string;
  icon: string;
};

/** Необязательные поля момента (в базе — колонка meta jsonb; без неё хранятся на устройстве). */
export type CheckpointMeta = {
  /** Дата момента YYYY-MM-DD (для многодневных поездок). */
  date?: string;
  weather?: Weather;
  /** Точный адрес (улица, дом) — отдельно от названия места. */
  address?: string;
  /** Тип момента при создании: фото, видео, аудио или заметка. */
  type?: "photo" | "video" | "audio" | "note";
  /** Свои метки: «рыбалка», «дача», «концерт». */
  tags?: string[];
  /** Настроение момента (эмодзи). */
  mood?: string;
};

export type TripMeta = {
  /** Дата окончания поездки YYYY-MM-DD. */
  endDate?: string;
  /** «trip» — поездка с маршрутом (по умолчанию), «event» — событие без поездки: просто вышел, и что-то случилось. */
  kind?: "trip" | "event" | "system";
  /** Оценка поездки 1–5 звёзд. */
  rating?: number;
  /** Сборы: чек-лист вещей. */
  packing?: PackItem[];
  /** Расходы поездки (в рублях). */
  expenses?: Expense[];
  /** Документы: билеты, брони, чеки (PDF, фото). */
  docs?: TripDoc[];
  /** Только для служебной записи (kind = "system"): альбомы, «Хочу поехать», свои шаблоны сборов. */
  userData?: UserData;
  /** Когда перенесено в корзину (ISO). Через 30 дней удаляется окончательно. */
  deletedAt?: string;
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
  /** Как добрались сюда от предыдущей точки. */
  arrivedBy?: TravelMode;
  coverMediaId?: MediaId;
  mediaIds: MediaId[];
  /** Если задано — точка является «большой локацией» со своей страницей. */
  place?: PlaceDetails;
  meta?: CheckpointMeta;
};

/* ───────────── Маршрут ───────────── */

export type TransportMode = "car" | "taxi" | "pedestrian" | "public";

/** Участок маршрута (зарезервировано на будущее, сейчас маршрут задаётся точками вручную). */
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
  meta?: TripMeta;
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
  /** Оригинал хранится на Google Диске (только локальная пометка). */
  drive?: boolean;
  /** Длительность видео/аудио, сек. */
  duration?: number;
  /** Когда снято (из EXIF), ISO без часового пояса: YYYY-MM-DDTHH:MM:SS. */
  takenAt?: string;
  /** Где снято (из EXIF GPS). */
  gps?: GeoPoint;
};

/* ───────────── Сборы, расходы, документы ───────────── */

export type PackItem = { id: string; text: string; done: boolean };

export type ExpenseCategory = "road" | "stay" | "food" | "fun" | "shop" | "other";
export type Expense = { id: string; title: string; amount: number; category: ExpenseCategory; date?: string };

/** Документ поездки. Файл лежит на Google Диске, в Supabase Storage или только на устройстве. */
export type TripDoc = {
  id: string;
  name: string;
  mime: string;
  size: number;
  provider: "gdrive" | "supabase" | "local";
  location?: { fileId?: string; path?: string };
  addedAt: string;
};

/* ───────────── Данные пользователя вне поездок ───────────── */

export type Album = { id: string; title: string; mediaIds: MediaId[]; createdAt: string };
export type Wish = { id: string; title: string; location?: Location; note?: string; createdAt: string; doneTripId?: string };
export type PackTemplate = { id: string; title: string; items: string[] };
export type UserData = { albums?: Album[]; wishes?: Wish[]; packTemplates?: PackTemplate[] };

/**
 * Нейтральный интерфейс картографического сервиса.
 * Сейчас реализован провайдер 2ГИС (lib/geo/twogis.ts). Чтобы заменить сервис,
 * достаточно написать другой провайдер с тем же интерфейсом — данные поездок не меняются.
 */
import type { GeoPoint, Location, RouteData, TransportMode } from "../types";

export type PlaceSuggestion = Location & {
  id: string;
  name: string;
  /** Адрес/район, если есть. */
  subtitle?: string;
  kind?: string;
};

export type RouteRequest = {
  from: Location;
  to: Location;
  mode: TransportMode;
  /** Промежуточные точки (для машины/такси/пешком). */
  via?: GeoPoint[];
};

export interface GeoProvider {
  readonly name: string;
  suggest(query: string, near?: GeoPoint): Promise<PlaceSuggestion[]>;
  route(req: RouteRequest): Promise<RouteData>;
}

export class GeoError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

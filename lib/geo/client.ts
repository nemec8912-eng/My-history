/** Клиентские вызовы серверных геомаршрутов приложения (не 2ГИС напрямую). */
import type { GeoPoint, RouteData } from "../types";
import type { PlaceSuggestion, RouteRequest } from "./types";

export async function fetchSuggestions(q: string, near?: GeoPoint, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q });
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lon));
  }
  const res = await fetch(`/api/geo/suggest?${params}`, { signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка поиска");
  return data.items ?? [];
}

export async function fetchRoute(req: RouteRequest): Promise<RouteData> {
  const res = await fetch("/api/geo/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не удалось построить маршрут");
  return data.route as RouteData;
}

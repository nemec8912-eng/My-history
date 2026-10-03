/**
 * Провайдер 2ГИС. Выполняется ТОЛЬКО на сервере (Next.js route handlers),
 * поэтому ключ для Catalog/Routing API не попадает в клиентский JavaScript.
 *
 * Документация:
 *  - Routing API: POST https://routing.api.2gis.com/routing/7.0.0/global
 *  - Public Transport API: POST https://routing.api.2gis.com/public_transport/2.0
 *  - Catalog API: GET https://catalog.api.2gis.com/3.0/items
 */
import type { GeoPoint, RouteData, RouteSegment } from "../types";
import { GeoError, type GeoProvider, type PlaceSuggestion, type RouteRequest } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const ROUTING = "https://routing.api.2gis.com/routing/7.0.0/global";
const PUBLIC = "https://routing.api.2gis.com/public_transport/2.0";
const CATALOG = "https://catalog.api.2gis.com/3.0";

const PT_TYPES = [
  "pedestrian", "metro", "light_metro", "suburban_train", "aeroexpress", "tram", "bus",
  "trolleybus", "shuttle_bus", "monorail", "funicular_railway", "river_transport",
  "cable_car", "light_rail", "premetro", "mcc", "mcd",
];

const PT_LABELS: Record<string, string> = {
  metro: "Метро",
  light_metro: "Лёгкое метро",
  suburban_train: "Электричка",
  aeroexpress: "Аэроэкспресс",
  tram: "Трамвай",
  bus: "Автобус",
  trolleybus: "Троллейбус",
  shuttle_bus: "Маршрутка",
  monorail: "Монорельс",
  funicular_railway: "Фуникулёр",
  river_transport: "Речной транспорт",
  cable_car: "Канатная дорога",
  light_rail: "Скоростной трамвай",
  premetro: "Метротрам",
  mcc: "МЦК",
  mcd: "МЦД",
};

/** Ключи раздельные: серверный (TWOGIS_API_KEY) и ключ карты (NEXT_PUBLIC_2GIS_MAP_KEY) как запасной вариант. */
function apiKey(): string {
  const key = process.env.TWOGIS_API_KEY || process.env.NEXT_PUBLIC_2GIS_MAP_KEY;
  if (!key) throw new GeoError("Ключ 2ГИС не задан на сервере (TWOGIS_API_KEY)", 503);
  return key;
}

/** WKT LINESTRING / MULTILINESTRING → массив ломаных [lon, lat]. */
export function parseWkt(wkt: string | undefined): [number, number][][] {
  if (!wkt) return [];
  const groups = wkt.match(/\(([^()]+)\)/g) ?? [];
  return groups
    .map((g) =>
      g
        .replace(/[()]/g, "")
        .split(",")
        .map((pair) => pair.trim().split(/\s+/).map(Number))
        .filter((n) => n.length >= 2 && Number.isFinite(n[0]) && Number.isFinite(n[1]))
        .map((n) => [n[0], n[1]] as [number, number])
    )
    .filter((l) => l.length > 1);
}

async function post(url: string, body: unknown): Promise<Json> {
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey())}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: Json = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* не JSON */
  }
  if (!res.ok) {
    const msg = data?.message || data?.error?.message || text.slice(0, 200);
    throw new GeoError(`2ГИС: ${res.status} ${msg}`, res.status === 403 || res.status === 401 ? 403 : 502);
  }
  return data;
}

async function routeRoad(req: RouteRequest): Promise<RouteData> {
  const walking = req.mode === "pedestrian";
  const stopType = walking ? "walking" : "stop";
  const points = [
    { type: stopType, lon: req.from.lon, lat: req.from.lat },
    ...(req.via ?? []).slice(0, 8).map((p) => ({ type: walking ? "walking" : "pref", lon: p.lon, lat: p.lat })),
    { type: stopType, lon: req.to.lon, lat: req.to.lat },
  ];
  const data = await post(ROUTING, {
    points,
    transport: walking ? "pedestrian" : req.mode === "taxi" ? "taxi" : "driving",
    output: "detailed",
    locale: "ru",
  });
  const r = data?.result?.[0];
  if (!r) throw new GeoError(data?.message || "Маршрут не найден", 404);

  const segments: RouteSegment[] = [];
  for (const m of r.maneuvers ?? []) {
    const path = m.outcoming_path;
    if (!path) continue;
    const lines = (path.geometry ?? []).flatMap((g: Json) => parseWkt(g.selection));
    if (!lines.length) continue;
    const kind: RouteSegment["kind"] = walking ? "walk" : "drive";
    const last = segments[segments.length - 1];
    // Склеиваем манёвры в один участок, чтобы не хранить сотни мелких кусков.
    if (last && last.kind === kind) {
      last.path.push(...lines);
      last.distance = (last.distance ?? 0) + (path.distance ?? 0);
      last.duration = (last.duration ?? 0) + (path.duration ?? 0);
    } else {
      segments.push({
        kind,
        transport: walking ? "Пешком" : req.mode === "taxi" ? "Такси" : "Автомобиль",
        distance: path.distance,
        duration: path.duration,
        path: lines,
      });
    }
  }
  return {
    mode: req.mode,
    from: req.from,
    to: req.to,
    distance: r.total_distance ?? segments.reduce((s, x) => s + (x.distance ?? 0), 0),
    duration: r.total_duration ?? segments.reduce((s, x) => s + (x.duration ?? 0), 0),
    segments,
    provider: "2gis",
    builtAt: new Date().toISOString(),
  };
}

function ptSegment(m: Json, next: Json | undefined): RouteSegment {
  const alt = m.alternatives?.[0] ?? {};
  const path = (alt.geometry ?? []).flatMap((g: Json) => parseWkt(g.selection));
  const route = m.routes?.[0] ?? alt.routes?.[0];
  const platforms: string[] = (alt.platforms ?? m.platforms ?? [])
    .map((p: Json) => p?.name ?? p?.names?.[0])
    .filter(Boolean);
  const duration = (m.moving_duration ?? 0) + (m.waiting_duration ?? 0) || undefined;

  if (m.type === "passage") {
    const subtype: string = route?.subtype ?? m.waypoint?.subtype ?? "";
    const label = route?.subtype_name || PT_LABELS[subtype] || "Транспорт";
    const names: string[] = route?.names ?? (route?.name ? [route.name] : []);
    const lines = m.metro?.line_name ? [m.metro.line_name, ...names] : names;
    return {
      kind: "transit",
      transport: label.charAt(0).toUpperCase() + label.slice(1),
      lines: Array.from(new Set(lines.filter(Boolean))),
      lineColor: m.metro?.color || route?.color || undefined,
      stops: platforms,
      from: m.waypoint?.name,
      to: next?.waypoint?.name,
      distance: m.distance,
      duration,
      path,
    };
  }
  return {
    kind: m.type === "crossing" ? "transfer" : "walk",
    transport: m.type === "crossing" ? "Пересадка" : "Пешком",
    from: m.waypoint?.name,
    to: next?.waypoint?.name,
    distance: m.distance,
    duration,
    path,
  };
}

async function routePublic(req: RouteRequest): Promise<RouteData> {
  const data = await post(PUBLIC, {
    source: { point: { lat: req.from.lat, lon: req.from.lon } },
    target: { point: { lat: req.to.lat, lon: req.to.lon } },
    transport: PT_TYPES,
    locale: "ru",
  });
  const list: Json[] = Array.isArray(data) ? data : data?.result ?? [];
  if (!list.length) throw new GeoError("Маршрут на общественном транспорте не найден", 404);
  const r = [...list].sort((a, b) => (a.total_duration ?? 1e9) - (b.total_duration ?? 1e9))[0];
  const movements: Json[] = r.movements ?? [];
  const segments = movements.map((m, i) => ptSegment(m, movements[i + 1])).filter((s) => s.path.length || s.kind === "transit");
  return {
    mode: "public",
    from: req.from,
    to: req.to,
    distance: r.total_distance ?? 0,
    duration: r.total_duration ?? 0,
    transfers: r.transfer_count ?? Math.max(0, segments.filter((s) => s.kind === "transit").length - 1),
    segments,
    provider: "2gis",
    builtAt: new Date().toISOString(),
  };
}

async function suggest(query: string, near?: GeoPoint): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    key: apiKey(),
    fields: "items.point,items.address,items.adm_div",
    page_size: "10",
    locale: "ru_RU",
  });
  if (near) params.set("location", `${near.lon},${near.lat}`);

  const get = async (path: string) => {
    const res = await fetch(`${CATALOG}/${path}?${params}`, { cache: "no-store" });
    const data: Json = await res.json().catch(() => null);
    if (!res.ok || (data?.meta?.code && data.meta.code >= 400 && data.meta.code !== 404)) {
      const msg = data?.meta?.error?.message || res.statusText;
      throw new GeoError(`2ГИС поиск: ${msg}`, res.status === 403 ? 403 : 502);
    }
    return (data?.result?.items ?? []) as Json[];
  };

  let items = await get("items");
  if (!items.some((i) => i.point)) items = await get("items/geocode");

  return items
    .filter((i) => i.point && Number.isFinite(i.point.lat))
    .map((i) => {
      const city = i.adm_div?.find((d: Json) => d.type === "city")?.name;
      const subtitle = [i.address_name, city].filter(Boolean).join(", ") || i.full_name || undefined;
      return {
        id: String(i.id ?? `${i.point.lat},${i.point.lon}`),
        name: i.name ?? i.full_name ?? query,
        subtitle: subtitle && subtitle !== i.name ? subtitle : undefined,
        kind: i.type,
        lat: i.point.lat,
        lon: i.point.lon,
        label: [i.name, i.address_name].filter(Boolean).join(", ") || i.full_name,
      };
    });
}

export const twogis: GeoProvider = {
  name: "2gis",
  suggest,
  route: (req) => (req.mode === "public" ? routePublic(req) : routeRoad(req)),
};

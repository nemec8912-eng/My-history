import { NextResponse } from "next/server";
import { twogis } from "@/lib/geo/twogis";
import { GeoError, type RouteRequest } from "@/lib/geo/types";
import type { TransportMode } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODES: TransportMode[] = ["car", "taxi", "pedestrian", "public"];

const isPoint = (p: unknown): p is { lat: number; lon: number } =>
  !!p &&
  typeof p === "object" &&
  Number.isFinite((p as { lat: number }).lat) &&
  Number.isFinite((p as { lon: number }).lon) &&
  Math.abs((p as { lat: number }).lat) <= 90 &&
  Math.abs((p as { lon: number }).lon) <= 180;

export async function POST(req: Request) {
  let body: Partial<RouteRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (!isPoint(body.from) || !isPoint(body.to)) {
    return NextResponse.json({ error: "Укажите начальную и конечную точки" }, { status: 400 });
  }
  const mode = MODES.includes(body.mode as TransportMode) ? (body.mode as TransportMode) : "car";
  const via = Array.isArray(body.via) ? body.via.filter(isPoint).map(({ lat, lon }) => ({ lat, lon })) : [];
  try {
    const route = await twogis.route({
      from: { lat: body.from.lat, lon: body.from.lon, label: body.from.label },
      to: { lat: body.to.lat, lon: body.to.lon, label: body.to.label },
      mode,
      via,
    });
    return NextResponse.json({ route });
  } catch (e) {
    const status = e instanceof GeoError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка построения маршрута" }, { status });
  }
}

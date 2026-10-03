import { NextResponse } from "next/server";
import { twogis } from "@/lib/geo/twogis";
import { GeoError } from "@/lib/geo/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const near = Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon } : undefined;
  try {
    const items = await twogis.suggest(q.slice(0, 120), near);
    return NextResponse.json({ items });
  } catch (e) {
    const status = e instanceof GeoError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка поиска" }, { status });
  }
}

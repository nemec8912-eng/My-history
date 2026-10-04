import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: "Моя история",
    short_name: "Моя история",
    description: "Личный дневник поездок и воспоминаний",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0d14",
    theme_color: "#0a0d14",
    lang: "ru",
    shortcuts: [
      { name: "Быстрый момент", short_name: "Сейчас", description: "Фото + место + время в два касания", url: `${base}/new/?quick=1`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: "192x192" }] },
      { name: "Импорт из галереи", short_name: "Импорт", url: `${base}/import/`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: "192x192" }] },
      { name: "Карта", short_name: "Карта", url: `${base}/map/`, icons: [{ src: `${base}/icons/icon-192.png`, sizes: "192x192" }] },
    ],
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

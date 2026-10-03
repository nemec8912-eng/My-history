/**
 * Статическая сборка (`out/`): сайт работает на любом хостинге — GitHub Pages,
 * Netlify, Cloudflare Pages, Vercel. Данные хранятся в браузере (IndexedDB)
 * и, при подключении, в Supabase — сервер Next.js не нужен.
 *
 * NEXT_PUBLIC_BASE_PATH — подпапка сайта (для GitHub Pages: "/My-history").
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;

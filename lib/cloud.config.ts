/**
 * Публичные параметры Supabase. Publishable/anon-ключ не секретный: доступ к данным
 * ограничен правилами RLS (supabase/schema.sql). Переменные окружения
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY имеют приоритет.
 */
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xmdrqnhzncgdiuhgorlg.supabase.co";

export const CLOUD = {
  /** Только адрес проекта, без /rest/v1 и завершающего слэша. */
  url: rawUrl.replace(/\/(rest|auth|storage)\/v1\/?$/, "").replace(/\/+$/, ""),
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_R2vAXu30FqIL0HgXGXV_cQ_GxAR3OgH",
};

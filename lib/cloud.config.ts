/**
 * Публичные параметры Supabase. anon-ключ не секретный: доступ к данным
 * ограничен правилами RLS (supabase/schema.sql). Переменные окружения
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY имеют приоритет.
 */
export const CLOUD = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
};

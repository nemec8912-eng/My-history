import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/** Возвращает клиент Supabase или null, если переменные окружения не заданы. */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  // Имена переменных должны быть записаны буквально — так Next.js подставляет их в клиентский код.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || typeof window === "undefined") {
    if (typeof window !== "undefined") client = null;
    return null;
  }
  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export function isCloudConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function getUserId(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

export const MEDIA_BUCKET = "media";

/** Проверка связи с Supabase: ok, нет сети/заблокирован, или ошибка конфигурации. */
export async function pingCloud(): Promise<{ ok: boolean; reason?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, reason: "Не заданы адрес и ключ Supabase" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: key }, signal: ctrl.signal });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "Supabase отклонил ключ: проверьте anon key" };
    return { ok: false, reason: `Supabase ответил ошибкой ${res.status}` };
  } catch {
    return { ok: false, reason: "Нет связи с Supabase: нет интернета или сервис недоступен из этой сети" };
  } finally {
    clearTimeout(t);
  }
}

/** Человекопонятный текст ошибок входа. */
export function authErrorText(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes")) return "Слишком много писем подряд. Подождите минуту и попробуйте снова.";
  if (m.includes("expired") || m.includes("invalid")) return "Код неверный или устарел. Запросите новый код.";
  if (m.includes("signups not allowed")) return "Регистрация новых пользователей выключена в настройках Supabase.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Нет связи с Supabase.";
  return message;
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CLOUD } from "./cloud.config";

let client: SupabaseClient | null | undefined;

/** Возвращает клиент Supabase или null, если переменные окружения не заданы. */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = CLOUD.url;
  const anonKey = CLOUD.anonKey;
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
  return Boolean(CLOUD.url && CLOUD.anonKey);
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
  const url = CLOUD.url;
  const key = CLOUD.anonKey;
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
  if (m.includes("invalid login credentials")) return "Неверный email или пароль.";
  if (m.includes("email not confirmed")) return "Email ещё не подтверждён: откройте ссылку из письма Supabase, затем войдите.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Такой email уже зарегистрирован — просто войдите.";
  if (m.includes("password should be")) return "Пароль слишком простой: минимум 6 символов.";
  if (m.includes("rate limit") || m.includes("security purposes")) return "Слишком много писем подряд. Подождите минуту и попробуйте снова.";
  if (m.includes("expired")) return "Ссылка или код устарели. Запросите новые.";
  if (m.includes("signups not allowed")) return "Регистрация новых пользователей выключена в настройках Supabase.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Нет связи с Supabase.";
  return message;
}

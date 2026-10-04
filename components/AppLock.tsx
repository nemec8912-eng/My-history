"use client";

import { useEffect, useState } from "react";
import { disableLock, isUnlocked, lockEnabled, markUnlocked, unlock } from "@/lib/applock";
import { getSupabase } from "@/lib/supabase";

/** Экран блокировки: Face ID / отпечаток при открытии и после 5 минут в фоне. */
export function AppLock() {
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const check = () => setLocked(lockEnabled() && !isUnlocked());
    check();
    let hiddenAt = 0;
    const vis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        if (lockEnabled()) markUnlocked(); // отсчёт 5 минут — с момента ухода в фон
      } else if (hiddenAt) check();
    };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  // Пока приложение открыто и не заблокировано — продлеваем сессию.
  useEffect(() => {
    if (locked || !lockEnabled()) return;
    const t = setInterval(markUnlocked, 30_000);
    return () => clearInterval(t);
  }, [locked]);

  if (!locked) return null;

  async function tryUnlock() {
    setErr(null);
    try {
      if (await unlock()) setLocked(false);
    } catch (e) {
      setErr((e as Error)?.name === "NotAllowedError" ? "Не получилось. Попробуйте ещё раз." : String((e as Error)?.message ?? e));
    }
  }

  async function byPassword() {
    setErr(null);
    const sb = getSupabase();
    const { data } = (await sb?.auth.getUser()) ?? { data: { user: null } };
    const email = data.user?.email;
    if (!sb || !email) return setErr("Нет входа в аккаунт на этом устройстве.");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return setErr("Неверный пароль.");
    disableLock();
    setLocked(false);
  }

  return (
    <div className="appLock" role="dialog" aria-label="Приложение заблокировано">
      <div className="alBox">
        <span className="alIcon">🔒</span>
        <h2>Моя история</h2>
        <p className="muted">Приложение защищено Face ID / отпечатком.</p>
        <button className="primary wide" onClick={tryUnlock} autoFocus>
          Разблокировать
        </button>
        {err && <p className="errorBar">{err}</p>}
        {!forgot ? (
          <button className="linkBtn" onClick={() => setForgot(true)}>
            Не получается? Войти паролем аккаунта
          </button>
        ) : (
          <div className="alForgot">
            <input type="password" placeholder="Пароль аккаунта" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <button className="softBtn" onClick={byPassword}>
              Войти и снять блокировку
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

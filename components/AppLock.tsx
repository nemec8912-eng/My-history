"use client";

import { useEffect, useRef, useState } from "react";
import { disableLock, isUnlocked, LOCK_AFTER_MS, lockEnabled, markUnlocked, unlock } from "@/lib/applock";
import { getSupabase } from "@/lib/supabase";

const setHtmlLocked = (on: boolean) => document.documentElement.classList.toggle("applocked", on);

/**
 * Экран блокировки: Face ID / отпечаток при открытии и после 5 минут в фоне.
 * Пока экран заблокирован, никакие переключения приложений его не снимают.
 */
export function AppLock() {
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [password, setPassword] = useState("");
  const lockedRef = useRef(false);
  const hiddenAt = useRef(0);

  const apply = (on: boolean) => {
    lockedRef.current = on;
    setLocked(on);
    setHtmlLocked(on);
  };

  useEffect(() => {
    apply(lockEnabled() && !isUnlocked());
    const vis = () => {
      if (!lockEnabled()) return;
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      // Вернулись: заблокировано — остаётся заблокированным; иначе блокируем, если в фоне дольше 5 минут.
      if (lockedRef.current || (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS)) apply(true);
      else markUnlocked();
    };
    document.addEventListener("visibilitychange", vis);
    // Пока приложение открыто и на экране — продлеваем сессию (в фоне не продлеваем).
    const t = setInterval(() => {
      if (!lockedRef.current && lockEnabled() && document.visibilityState === "visible") markUnlocked();
    }, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      clearInterval(t);
    };
  }, []);

  if (!locked) return null;

  async function tryUnlock() {
    setErr(null);
    try {
      if (await unlock()) apply(false);
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
    apply(false);
  }

  /** Если нет пароля (вход по ссылке) или Face ID сломался: выйти из аккаунта — облачные данные защищены входом. */
  async function signOutAndUnlock() {
    if (!confirm("Выйти из аккаунта и снять замок? Ваши записи останутся в облаке — войдите снова, чтобы их увидеть.")) return;
    await getSupabase()?.auth.signOut().catch(() => undefined);
    disableLock();
    location.reload();
  }

  return (
    <div className="appLock" role="dialog" aria-modal="true" aria-label="Приложение заблокировано">
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
            Не получается?
          </button>
        ) : (
          <div className="alForgot">
            <input type="password" placeholder="Пароль аккаунта" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <button className="softBtn" onClick={byPassword} disabled={!password}>
              Войти паролем и снять замок
            </button>
            <button className="linkBtn" onClick={signOutAndUnlock}>
              Нет пароля — выйти из аккаунта и снять замок
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

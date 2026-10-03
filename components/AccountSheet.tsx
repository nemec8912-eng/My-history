"use client";

import { FormEvent, useEffect, useState } from "react";
import { syncPendingUploads } from "@/lib/media/store";
import { localTripCount, migrateLocalToCloud } from "@/lib/repo";
import { authErrorText, getSupabase, isCloudConfigured, pingCloud } from "@/lib/supabase";
import { errorText } from "@/lib/useTrip";
import { Sheet } from "./Sheet";
import { asset } from "@/lib/routes";

/**
 * Аккаунт: вход по email-коду (работает и в PWA на iPhone, где ссылка из письма
 * открылась бы в Safari, а не в установленном приложении).
 */
export function AccountSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const sb = getSupabase();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [user, setUser] = useState<string | null>(null);
  const [local, setLocal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [net, setNet] = useState<{ ok: boolean; reason?: string } | null>(null);

  useEffect(() => {
    if (!sb) return;
    pingCloud().then(setNet);
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user.email ?? null));
    localTripCount().then(setLocal);
  }, [sb]);

  if (!sb || !isCloudConfigured()) {
    return (
      <Sheet onClose={onClose}>
        <div className="editor">
          <p className="eyebrow">Аккаунт</p>
          <h3>Облако ещё не подключено</h3>
          <p className="muted">
            Сейчас поездки и фото хранятся только на этом устройстве. Чтобы видеть ту же историю на iPhone, Android и
            компьютере, нужно подключить Supabase (инструкция в README репозитория).
          </p>
        </div>
      </Sheet>
    );
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await sb!.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + asset("/"), shouldCreateUser: true },
    });
    setBusy(false);
    if (error) return setMsg(authErrorText(error.message));
    setStage("code");
    setMsg("Письмо отправлено. Введите код из письма (проверьте и папку «Спам»).");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await sb!.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setMsg(authErrorText(error.message));
    setUser(data.user?.email ?? email);
    void syncPendingUploads();
    onChanged();
  }

  async function migrate() {
    setBusy(true);
    try {
      const n = await migrateLocalToCloud((m) => setMsg(m));
      setMsg(`Перенесено поездок: ${n}`);
      setLocal(0);
      onChanged();
    } catch (e) {
      setMsg("Ошибка: " + errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await sb!.auth.signOut();
    setUser(null);
    onChanged();
  }

  return (
    <Sheet onClose={onClose}>
      <div className="editor">
        <p className="eyebrow">Аккаунт</p>
        {net && !net.ok && <p className="errorBar">{net.reason}. Поездки продолжают сохраняться на этом устройстве.</p>}
        {user ? (
          <>
            <h3>Вы вошли</h3>
            <p className="muted">{user}</p>
            <p className="muted small">Поездки и фото сохраняются в облаке и доступны на всех ваших устройствах.</p>
            {local > 0 && (
              <div className="emptyCard" style={{ marginTop: 14 }}>
                <p>
                  На этом устройстве есть поездки, которых нет в аккаунте: <strong>{local}</strong>.
                </p>
                <button className="primary" disabled={busy} onClick={migrate} style={{ marginTop: 10 }}>
                  Перенести в аккаунт
                </button>
              </div>
            )}
            <div className="editorActions">
              <button className="softBtn" onClick={signOut}>Выйти</button>
            </div>
          </>
        ) : stage === "email" ? (
          <form onSubmit={sendCode}>
            <h3>Вход</h3>
            <p className="muted small">Войдите, чтобы история была одинаковой на телефоне, планшете и компьютере.</p>
            <label>
              Email
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="primary wide" disabled={busy}>Получить код</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <h3>Код из письма</h3>
            <label>
              Код
              <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <div className="editorActions">
              <button type="button" className="softBtn" onClick={() => setStage("email")}>Другой email</button>
              <button className="primary" disabled={busy}>Войти</button>
            </div>
          </form>
        )}
        {msg && <p className="hint">{msg}</p>}
      </div>
    </Sheet>
  );
}

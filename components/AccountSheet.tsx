"use client";

import { FormEvent, useEffect, useState } from "react";
import { syncPendingUploads } from "@/lib/media/store";
import { localTripCount, migrateLocalToCloud } from "@/lib/repo";
import { asset } from "@/lib/routes";
import { authErrorText, getSupabase, isCloudConfigured, pingCloud } from "@/lib/supabase";
import { errorText } from "@/lib/useTrip";
import { Sheet } from "./Sheet";
import { DriveSection } from "./DriveSection";
import { StorageSection } from "./StorageSection";

type Stage = "signin" | "signup" | "link" | "reset" | "newPassword";

/**
 * Аккаунт: вход по email и паролю. Подтверждение регистрации и сброс пароля —
 * по ссылке из стандартного письма Supabase. Пароль работает и в PWA на iPhone,
 * где ссылка из письма открылась бы в Safari, а не в установленном приложении.
 */
export function AccountSheet(props: { onClose: () => void; onChanged: () => void; initialStage?: Stage }) {
  return (
    <Sheet onClose={props.onClose}>
      <AccountPanel onChanged={props.onChanged} initialStage={props.initialStage} />
    </Sheet>
  );
}

/** Содержимое раздела «Я»: вход, Google Диск, место, синхронизация. */
export function AccountPanel({
  onChanged,
  initialStage,
}: {
  onChanged: () => void;
  initialStage?: Stage;
}) {
  const sb = getSupabase();
  const [stage, setStage] = useState<Stage>(initialStage ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<string | null>(null);
  const [local, setLocal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [net, setNet] = useState<{ ok: boolean; reason?: string } | null>(null);
  const redirectTo = typeof window !== "undefined" ? window.location.origin + asset("/") : undefined;

  useEffect(() => {
    if (!sb) return;
    pingCloud().then(setNet);
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user.email ?? null));
    localTripCount().then(setLocal);
  }, [sb]);

  if (!sb || !isCloudConfigured()) {
    return (
      <>
        <div className="editor">
          <p className="eyebrow">Аккаунт</p>
          <h3>Облако ещё не подключено</h3>
          <p className="muted">Сейчас поездки и фото хранятся только на этом устройстве.</p>
        </div>
      </>
    );
  }

  const fail = (m: string) => setMsg({ text: authErrorText(m), error: true });
  const ok = (m: string) => setMsg({ text: m });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      fail(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const signedIn = (mail: string | null | undefined) => {
    setUser(mail ?? email);
    void syncPendingUploads();
    localTripCount().then(setLocal);
    onChanged();
  };

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return fail(error.message);
      signedIn(data.user?.email);
    });
  };

  const signUp = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return fail("Пароль должен быть не короче 6 символов");
    void run(async () => {
      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) return fail(error.message);
      if (data.session) return signedIn(data.user?.email);
      setStage("signin");
      ok("Готово! Откройте письмо от Supabase и нажмите ссылку подтверждения. После этого войдите здесь с тем же email и паролем.");
    });
  };

  const sendLink = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } });
      if (error) return fail(error.message);
      ok("Письмо отправлено. Откройте ссылку из письма в этом же браузере.");
    });
  };

  const sendReset = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) return fail(error.message);
      ok("Письмо для смены пароля отправлено. Откройте ссылку из письма — здесь появится поле нового пароля.");
    });
  };

  const setNewPassword = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return fail("Пароль должен быть не короче 6 символов");
    void run(async () => {
      const { data, error } = await sb.auth.updateUser({ password });
      if (error) return fail(error.message);
      ok("Пароль изменён.");
      signedIn(data.user?.email);
    });
  };

  const migrate = () =>
    run(async () => {
      const n = await migrateLocalToCloud((m) => ok(m));
      ok(`Перенесено поездок: ${n}`);
      setLocal(0);
      onChanged();
    });

  const signOut = () =>
    run(async () => {
      await sb.auth.signOut();
      setUser(null);
      setStage("signin");
      onChanged();
    });

  const emailField = (
    <label>
      Email
      <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
    </label>
  );
  const passwordField = (autoComplete: string) => (
    <label>
      Пароль
      <input type="password" required minLength={6} autoComplete={autoComplete} value={password} onChange={(e) => setPassword(e.target.value)} />
    </label>
  );

  return (
    <>
      <div className="editor accountSheet">
        <p className="eyebrow">Аккаунт</p>
        {net && !net.ok && <p className="errorBar">{net.reason}. Поездки продолжают сохраняться на этом устройстве.</p>}

        {user && stage !== "newPassword" ? (
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
            <DriveSection />
            <StorageSection />
            <div className="editorActions">
              <button className="softBtn" onClick={signOut} disabled={busy}>
                Выйти
              </button>
            </div>
          </>
        ) : stage === "newPassword" ? (
          <form onSubmit={setNewPassword}>
            <h3>Новый пароль</h3>
            {passwordField("new-password")}
            <button className="primary wide" disabled={busy}>Сохранить пароль</button>
          </form>
        ) : stage === "signup" ? (
          <form onSubmit={signUp}>
            <h3>Регистрация</h3>
            <p className="muted small">После регистрации придёт письмо со ссылкой подтверждения.</p>
            {emailField}
            {passwordField("new-password")}
            <button className="primary wide" disabled={busy}>Создать аккаунт</button>
            <button type="button" className="linkBtn" onClick={() => setStage("signin")}>Уже есть аккаунт — войти</button>
          </form>
        ) : stage === "link" ? (
          <form onSubmit={sendLink}>
            <h3>Вход по ссылке</h3>
            <p className="muted small">Подходит для браузера на компьютере. На iPhone в приложении с главного экрана используйте пароль.</p>
            {emailField}
            <button className="primary wide" disabled={busy}>Отправить ссылку</button>
            <button type="button" className="linkBtn" onClick={() => setStage("signin")}>Войти по паролю</button>
          </form>
        ) : stage === "reset" ? (
          <form onSubmit={sendReset}>
            <h3>Сброс пароля</h3>
            {emailField}
            <button className="primary wide" disabled={busy}>Прислать ссылку</button>
            <button type="button" className="linkBtn" onClick={() => setStage("signin")}>Назад ко входу</button>
          </form>
        ) : (
          <form onSubmit={signIn}>
            <h3>Вход</h3>
            <p className="muted small">Войдите, чтобы история была одинаковой на телефоне, планшете и компьютере.</p>
            {emailField}
            {passwordField("current-password")}
            <button className="primary wide" disabled={busy}>Войти</button>
            <div className="authLinks">
              <button type="button" className="linkBtn" onClick={() => setStage("signup")}>Создать аккаунт</button>
              <button type="button" className="linkBtn" onClick={() => setStage("reset")}>Забыли пароль?</button>
              <button type="button" className="linkBtn" onClick={() => setStage("link")}>Войти по ссылке</button>
            </div>
          </form>
        )}

        {msg && <p className={msg.error ? "errorBar" : "okBar"}>{msg.text}</p>}
        {busy && <p className="muted small">Подождите…</p>}
      </div>
    </>
  );
}

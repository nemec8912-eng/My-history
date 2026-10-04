/**
 * Google Диск как хранилище оригиналов фото, видео и голосовых.
 *
 * Вход — Google Identity Services (token model): в браузере нужен только Client ID,
 * Client Secret не используется и в коде отсутствует. Доступ запрашивается к одной
 * области drive.file: приложение видит ТОЛЬКО файлы, которые создало само
 * (папка «Моя история»), а не весь Диск.
 */

export const GOOGLE_CLIENT_ID = "1070994696426-v3iu3kofjktbkui5q575ffho9t14oi1h.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Моя история";
const LS_TOKEN = "gdrive-token";
const LS_ENABLED = "gdrive-enabled";
const LS_FOLDER = "gdrive-folder";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void; callback: (r: any) => void; error_callback?: (e: any) => void };

let gisPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;
const listeners = new Set<() => void>();

export function onDriveChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => fn());
}

function ls(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function isDriveEnabled(): boolean {
  return ls()?.getItem(LS_ENABLED) === "1";
}

/** Действующий токен доступа или null (токен живёт около часа). */
export function getDriveToken(): string | null {
  const raw = ls()?.getItem(LS_TOKEN);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as { token: string; exp: number };
    return t.exp - 60_000 > Date.now() ? t.token : null;
  } catch {
    return null;
  }
}

export function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if ((window as any).google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Не удалось загрузить вход Google. Проверьте интернет."));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * Запрашивает доступ к Диску. Вызывать только из обработчика нажатия
 * (иначе браузер заблокирует окно входа Google).
 */
export function connectDrive(): Promise<string> {
  if (isStandalone()) {
    connectDriveRedirect();
    return new Promise<string>(() => undefined); // страница уходит на Google
  }
  return loadGis().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const g = (window as any).google;
        if (!tokenClient) {
          tokenClient = g.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPE,
            callback: () => undefined,
          }) as TokenClient;
        }
        tokenClient.callback = (resp: any) => {
          if (resp?.error || !resp?.access_token) {
            reject(new Error(resp?.error_description || resp?.error || "Доступ к Google Диску не выдан"));
            return;
          }
          ls()?.setItem(LS_TOKEN, JSON.stringify({ token: resp.access_token, exp: Date.now() + Number(resp.expires_in ?? 3600) * 1000 }));
          ls()?.setItem(LS_ENABLED, "1");
          emit();
          resolve(resp.access_token);
        };
        tokenClient.error_callback = (err: any) => {
          if (err?.type === "popup_failed_to_open") {
            connectDriveRedirect(); // браузер заблокировал окно — входим переходом на страницу Google
            return;
          }
          reject(new Error(err?.type === "popup_closed" ? "Окно входа Google закрыто" : err?.message || "Ошибка входа Google"));
        };
        tokenClient.requestAccessToken({ prompt: isDriveEnabled() ? "" : "consent" });
      })
  );
}

/* ───────── Вход переходом на страницу Google (для PWA на iPhone) ───────── */

const REDIRECT_PATH = "/gdrive/";
let captured: { returnTo: string | null; error: string | null } | null | undefined;

function basePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

/** Приложение открыто с главного экрана (standalone): всплывающие окна там ненадёжны. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

/** Переходит на страницу Google для выдачи доступа; после согласия вернёт на /gdrive/ с токеном. */
export function connectDriveRedirect(silent = false) {
  const redirect = window.location.origin + basePath() + REDIRECT_PATH;
  const returnTo = window.location.pathname + window.location.search;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "token",
    scope: SCOPE,
    include_granted_scopes: "true",
    state: "gdrive:" + returnTo,
  });
  if (silent) params.set("prompt", "none");
  else if (!isDriveEnabled()) params.set("prompt", "consent");
  window.location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
}

/**
 * Забирает токен из адреса после возврата со страницы Google (#access_token=…&state=gdrive:…).
 * Идемпотентно: повторный вызов возвращает тот же результат.
 */
export function captureDriveRedirect(): { returnTo: string | null; error: string | null } | null {
  if (captured !== undefined) return captured;
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const state = hash.get("state") ?? "";
  if (!state.startsWith("gdrive:")) {
    captured = null;
    return null;
  }
  const token = hash.get("access_token");
  const error = hash.get("error");
  if (token) {
    ls()?.setItem(LS_TOKEN, JSON.stringify({ token, exp: Date.now() + Number(hash.get("expires_in") ?? 3600) * 1000 }));
    ls()?.setItem(LS_ENABLED, "1");
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  captured = {
    returnTo: state.slice("gdrive:".length) || null,
    error: token ? null : error === "access_denied" ? "Доступ к Google Диску не выдан" : error || "Не удалось подключить Google Диск",
  };
  emit();
  return captured;
}

export function disconnectDrive() {
  const t = getDriveToken();
  if (t) {
    try {
      (window as any).google?.accounts?.oauth2?.revoke?.(t, () => undefined);
    } catch {
      /* ignore */
    }
  }
  ls()?.removeItem(LS_TOKEN);
  ls()?.removeItem(LS_ENABLED);
  ls()?.removeItem(LS_FOLDER);
  emit();
}

async function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path.startsWith("http") ? path : `https://www.googleapis.com${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    ls()?.removeItem(LS_TOKEN);
    emit();
    throw new Error(DRIVE_EXPIRED_MESSAGE);
  }
  return res;
}

async function ensureFolder(token: string): Promise<string> {
  const cached = ls()?.getItem(LS_FOLDER);
  if (cached) return cached;
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await api(`/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, token)).json();
  let id: string | undefined = found?.files?.[0]?.id;
  if (!id) {
    const res = await api(`/drive/v3/files?fields=id`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    });
    if (!res.ok) throw new Error(`Google Диск: не удалось создать папку (${res.status})`);
    id = (await res.json()).id;
  }
  ls()?.setItem(LS_FOLDER, id!);
  return id!;
}

/** Сообщение api() при истёкшем токене — по нему store отличает «нужен вход» от сетевой ошибки. */
export const DRIVE_EXPIRED_MESSAGE = "Доступ к Google Диску истёк — подключите снова";

/**
 * Создаёт сессию возобновляемой загрузки и возвращает её адрес (живёт около недели).
 * Сами байты по этому адресу отправляются без токена, поэтому истечение токена
 * посреди загрузки большого видео её не прерывает.
 */
export async function createDriveSession(name: string, mime: string, size: number, appProperties: Record<string, string>, retried = false): Promise<string> {
  const token = getDriveToken();
  if (!token) throw new Error("NO_TOKEN");
  const folder = await ensureFolder(token);
  const init = await api(`/upload/drive/v3/files?uploadType=resumable&fields=id,size`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mime || "application/octet-stream",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({ name, parents: [folder], appProperties }),
  });
  if (init.status === 404 && !retried && ls()?.getItem(LS_FOLDER)) {
    // Папку удалили на Диске — создаём заново и пробуем ещё раз.
    ls()?.removeItem(LS_FOLDER);
    return createDriveSession(name, mime, size, appProperties, true);
  }
  if (!init.ok) throw new Error(`Google Диск: ошибка ${init.status}`);
  const location = init.headers.get("Location");
  if (!location) throw new Error("Google Диск не вернул адрес загрузки");
  return location;
}

/** Загружает файл в папку «Моя история» одним запросом (фото и голосовые; видео — см. store.uploadVideo). */
export async function uploadToDrive(blob: Blob, name: string, mime: string, appProperties: Record<string, string>): Promise<{ fileId: string; size: number }> {
  const location = await createDriveSession(name, mime, blob.size, appProperties);
  const put = await fetch(location, { method: "PUT", headers: { "Content-Type": mime || "application/octet-stream" }, body: blob });
  if (!put.ok) throw new Error(`Google Диск: загрузка не удалась (${put.status})`);
  const data = await put.json();
  return { fileId: data.id, size: Number(data.size ?? blob.size) };
}

export async function downloadFromDrive(fileId: string): Promise<Blob | null> {
  const token = getDriveToken();
  if (!token) return null;
  const res = await api(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, token);
  return res.ok ? res.blob() : null;
}

export async function driveQuota(): Promise<{ used: number; limit: number | null } | null> {
  const token = getDriveToken();
  if (!token) return null;
  const res = await api(`/drive/v3/about?fields=storageQuota`, token);
  if (!res.ok) return null;
  const q = (await res.json()).storageQuota ?? {};
  return { used: Number(q.usage ?? 0), limit: q.limit ? Number(q.limit) : null };
}

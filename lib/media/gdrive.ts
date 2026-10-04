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
          reject(new Error(err?.type === "popup_closed" ? "Окно входа Google закрыто" : err?.message || "Ошибка входа Google"));
        };
        tokenClient.requestAccessToken({ prompt: isDriveEnabled() ? "" : "consent" });
      })
  );
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
    throw new Error("Доступ к Google Диску истёк — подключите снова");
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

/** Загружает файл в папку «Моя история» (возобновляемая загрузка — подходит и для больших видео). */
export async function uploadToDrive(blob: Blob, name: string, mime: string, appProperties: Record<string, string>): Promise<{ fileId: string; size: number }> {
  const token = getDriveToken();
  if (!token) throw new Error("NO_TOKEN");
  const folder = await ensureFolder(token);
  const init = await api(`/upload/drive/v3/files?uploadType=resumable&fields=id,size`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mime || "application/octet-stream",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify({ name, parents: [folder], appProperties }),
  });
  if (!init.ok) throw new Error(`Google Диск: ошибка ${init.status}`);
  const location = init.headers.get("Location");
  if (!location) throw new Error("Google Диск не вернул адрес загрузки");
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

/**
 * Замок приложения по Face ID / Touch ID / отпечатку (WebAuthn, ключ хранится в телефоне).
 * Это защита от посторонних глаз на этом устройстве: данные в облаке защищает вход в аккаунт.
 */
const KEY = "app-lock-credential";
const UNLOCK_KEY = "app-lock-unlocked-at";
export const LOCK_AFTER_MS = 5 * 60_000;

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export function lockEnabled(): boolean {
  try {
    return Boolean(localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

export async function lockSupported(): Promise<boolean> {
  try {
    return Boolean(window.PublicKeyCredential) && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export async function enableLock(): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: "Моя история", id: location.hostname },
      user: { id: random(16), name: "Моя история", displayName: "Моя история" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Не удалось создать ключ");
  localStorage.setItem(KEY, b64(cred.rawId));
  markUnlocked();
}

export function disableLock() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(UNLOCK_KEY);
}

export async function unlock(): Promise<boolean> {
  const id = localStorage.getItem(KEY);
  if (!id) return true;
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: unb64(id) }],
      userVerification: "required",
      timeout: 60_000,
    },
  });
  if (!res) return false;
  markUnlocked();
  return true;
}

export function markUnlocked() {
  try {
    sessionStorage.setItem(UNLOCK_KEY, String(Date.now()));
  } catch {
    /* ничего */
  }
}

export function isUnlocked(): boolean {
  try {
    const t = Number(sessionStorage.getItem(UNLOCK_KEY) || 0);
    return Date.now() - t < LOCK_AFTER_MS;
  } catch {
    return false;
  }
}

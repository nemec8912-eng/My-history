/**
 * Напоминание «Этот день». Android/Chrome (установленное приложение) проверяет раз в день в фоне;
 * на iPhone фоновые проверки Safari не разрешает — напоминание приходит при открытии приложения.
 */
const KEY = "this-day-reminders";

export function remindersEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function enableReminders(): Promise<{ ok: boolean; background: boolean; message: string }> {
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, background: false, message: "Этот браузер не умеет показывать уведомления. На iPhone добавьте приложение на экран «Домой» и откройте его оттуда." };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, background: false, message: "Уведомления не разрешены. Их можно включить в настройках браузера." };
  localStorage.setItem(KEY, "1");
  const reg: any = await navigator.serviceWorker.ready;
  let background = false;
  if (reg.periodicSync) {
    try {
      const st = await (navigator.permissions as any).query({ name: "periodic-background-sync" });
      if (st.state === "granted") {
        await reg.periodicSync.register("this-day", { minInterval: 12 * 3600 * 1000 });
        background = true;
      }
    } catch {
      /* не поддерживается */
    }
  }
  reg.active?.postMessage("check-this-day");
  return {
    ok: true,
    background,
    message: background ? "Готово: раз в день приложение само напомнит о моментах прошлых лет." : "Готово: напоминание придёт, когда вы открываете приложение в день, когда у вас есть воспоминания.",
  };
}

export async function disableReminders() {
  try {
    localStorage.removeItem(KEY);
    const reg: any = await navigator.serviceWorker.ready;
    await reg.periodicSync?.unregister("this-day");
  } catch {
    /* ничего */
  }
}

/** При открытии приложения: проверить «Этот день» (раз в сутки — повторно не напоминает). */
export function checkRemindersOnOpen() {
  if (!remindersEnabled() || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage("check-this-day")).catch(() => undefined);
}

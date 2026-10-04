// Облако: правка без сети попадает в Supabase, когда сеть возвращается. Запускается по метке [cloud-e2e] в коммите.
// Создаёт одну тестовую учётную запись (если в Supabase разрешён вход без подтверждения почты) и удаляет свои данные в конце.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screens";
const SB = "https://xmdrqnhzncgdiuhgorlg.supabase.co";
const KEY = "sb_publishable_R2vAXu30FqIL0HgXGXV_cQ_GxAR3OgH";
const log = [];
const ok = (cond, msg) => log.push(`[cloud] ${cond ? "PASS" : "FAIL"} ${msg}`);

const settings = await fetch(`${SB}/auth/v1/settings`, { headers: { apikey: KEY } }).then((r) => r.json()).catch(() => null);
log.push(`[cloud] auth settings: autoconfirm=${settings?.mailer_autoconfirm} email=${settings?.external?.email}`);

if (!settings?.mailer_autoconfirm) {
  log.push("[cloud] SKIP: Supabase требует подтверждение почты — тестовую учётную запись без почтового ящика создать нельзя");
} else {
  const email = `e2e-${Date.now()}@example.com`;
  const password = `E2e-${Math.random().toString(36).slice(2)}!`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: "ru-RU", viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  const token = () =>
    page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
      return k ? JSON.parse(localStorage.getItem(k)).access_token : null;
    });
  const rest = async (path) => {
    const t = await token();
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${t}` } });
    return r.json();
  };
  let step = "signup";
  try {
    await page.goto(BASE + "/me/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Создать аккаунт" }).first().click();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: "Создать аккаунт" }).first().click();
    await page.waitForSelector("text=Вы вошли", { timeout: 20000 });
    ok(true, "test account signed in");

    step = "create";
    await page.goto(BASE + "/new/", { waitUntil: "load" });
    await page.locator(".typeTabs button", { hasText: "Заметка" }).click();
    await page.locator(".newMoment textarea").fill("Облачная заметка");
    await page.getByRole("button", { name: "Сохранить момент" }).click();
    await page.waitForURL(/\/moment\/\?/, { timeout: 20000 });
    const u = new URL(page.url());
    const tripId = u.searchParams.get("trip");
    const cpId = u.searchParams.get("cp");
    await page.waitForTimeout(2500);
    let rows = await rest(`checkpoints?id=eq.${cpId}&select=description`);
    ok(rows[0]?.description === "Облачная заметка", `saved to Supabase online: "${rows[0]?.description}"`);

    step = "offline-edit";
    await ctx.setOffline(true);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.locator(".sheet textarea").first().fill("Исправлено без интернета");
    await page.locator('.sheet button[type="submit"]').click();
    await page.waitForTimeout(1500);
    const bar = await page.locator(".offlineBar").textContent().catch(() => "");
    ok(/ждут отправки: 1 изменение/.test(bar), `offline bar: "${bar}"`);
    await page.screenshot({ path: `${OUT}/cloud-offline.png` }).catch(() => {});

    step = "back-online";
    await ctx.setOffline(false);
    await page.waitForTimeout(6000);
    rows = await rest(`checkpoints?id=eq.${cpId}&select=description`);
    ok(rows[0]?.description === "Исправлено без интернета", `after reconnect Supabase has: "${rows[0]?.description}"`);
    ok((await page.locator(".offlineBar").count()) === 0, "offline bar gone after sync");

    step = "trash-sync";
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.locator(".sheet .dangerBtn").click();
    await page.waitForTimeout(2500);
    const t = await rest(`trips?id=eq.${tripId}&select=meta`);
    ok(Boolean(t[0]?.meta?.deletedAt), "trash state synced to Supabase (meta.deletedAt)");

    step = "cleanup";
    await page.goto(BASE + "/trash/", { waitUntil: "load" });
    await page.waitForSelector(".trashItem", { timeout: 15000 });
    await page.getByRole("button", { name: "Удалить навсегда" }).click();
    await page.waitForTimeout(2500);
    const gone = await rest(`trips?id=eq.${tripId}&select=id`);
    ok(Array.isArray(gone) && gone.length === 0, "purged from Supabase");
  } catch (e) {
    log.push(`[cloud] FAILED at ${step}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${OUT}/cloud-fail.png` }).catch(() => {});
  }
  await browser.close();
}

fs.mkdirSync(OUT, { recursive: true });
fs.appendFileSync(`${OUT}/log.txt`, "\n" + log.join("\n") + "\n");
console.log(log.join("\n"));

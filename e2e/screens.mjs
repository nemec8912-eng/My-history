// Снимки экрана приложения в WebKit (движок Safari) с размерами iPhone и в Chromium (Android/ПК).
import { chromium, devices, webkit } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screens";
const ONLY = process.env.ONLY;
fs.mkdirSync(OUT, { recursive: true });
const log = [];

async function run(name, browserType, device) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...device, locale: "ru-RU" });
  const page = await ctx.newPage();
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && log.push(`[${name}] console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => log.push(`[${name}] pageerror: ${e.message}`));
  const shot = async (n, full = false) => page.screenshot({ path: `${OUT}/${name}-${n}.png`, fullPage: full });
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await shot("1-home");
    await page.getByRole("button", { name: "Аккаунт" }).click();
    await page.waitForTimeout(3000);
    await shot("1b-account");
    const err = await page.locator(".sheet .errorBar").textContent().catch(() => null);
    const title = await page.locator(".sheet h3").first().textContent().catch(() => null);
    log.push(`[${name}] account: title=${title} error=${err}`);
    await page.locator(".sheet input[type=email]").fill("e2e-check@example.com");
    await page.locator(".sheet input[type=password]").fill("wrong-password-123");
    await page.locator(".sheet button.primary").click();
    await page.waitForTimeout(3500);
    log.push(`[${name}] login with wrong password -> ${await page.locator(".sheet .errorBar").last().textContent().catch(() => "no message")}`);
    await shot("1c-login-error");
    await page.locator(".sheetClose").click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Открыть пример" }).click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    await page.waitForTimeout(3500);
    await shot("2-trip");
    await shot("3-trip-full", true);
    await shot("2b-strip");
    await page.locator(".storyCard", { hasText: "Кафе" }).first().click();
    await page.waitForTimeout(1200);
    log.push(`[${name}] modal: ` + JSON.stringify(await page.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { top: Math.round(b.top), h: Math.round(b.height), op: cs.opacity, pos: cs.position, tr: cs.transform }; };
      const vv = window.visualViewport;
      return { scrollY: window.scrollY, innerH: window.innerHeight, vvTop: vv && vv.offsetTop, vvH: vv && vv.height, backdrop: r(".modalBackdrop"), sheet: r(".sheet"), bodyOverflow: document.body.style.overflow };
    })));
    await shot("4-point");
    await page.locator(".sheet").evaluate((el) => el.scrollTo(0, 500));
    await page.waitForTimeout(300);
    await shot("4b-point-lower");
    await page.locator(".sheet").evaluate((el) => el.scrollTo(0, 0));
    await page.getByRole("button", { name: "Дальше ›" }).click();
    await page.waitForTimeout(600);
    log.push(`[${name}] next point -> ${await page.locator(".premiumHero h3").textContent().catch(() => "?")}`);
    await page.getByRole("button", { name: "‹ Раньше" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Изменить", exact: true }).click();
    await page.waitForTimeout(500);
    await shot("5-editor");
    await page.locator(".sheet").evaluate((el) => el.scrollTo(0, 700));
    await page.waitForTimeout(300);
    await shot("6-editor-2");
    await page.getByRole("button", { name: "Отмена" }).click();
    await page.waitForTimeout(400);
    await page.locator(".sheetClose").click().catch(() => {});
    await page.waitForTimeout(400);
    await page.locator(".destCard").click();
    await page.waitForURL(/\/place\/\?/, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await shot("7-place");
    await page.goBack();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await shot("8-trip-after-reload");
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);
    await shot("9-home-with-trip");
    await shot("9b-home-full", true);
    await page.goto(BASE + "/trip/?id=" + new URL(page.url()).searchParams.get("id"), { waitUntil: "networkidle" }).catch(() => {});
    log.push(`[${name}] OK url=${page.url()} overflowX=${await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
  } catch (e) {
    log.push(`[${name}] FAILED: ${e.message}`);
    await shot("fail").catch(() => {});
  }
  await browser.close();
}

if (!ONLY || ONLY.includes("iphone")) await run("iphone", webkit, devices["iPhone 13"]);
if (!ONLY || ONLY.includes("android")) await run("android", chromium, devices["Pixel 7"]);
if (!ONLY || ONLY.includes("desktop")) await run("desktop", chromium, { viewport: { width: 1280, height: 860 } });
fs.appendFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));

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
    await shot("01-home-empty");

    // «Я»: вход и ошибка неверного пароля
    await page.goto(BASE + "/me/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    log.push(`[${name}] me: title=${await page.locator(".meCard h3").first().textContent().catch(() => null)} error=${await page.locator(".meCard .errorBar").first().textContent().catch(() => null)}`);
    await page.locator(".meCard input[type=email]").fill("e2e-check@example.com");
    await page.locator(".meCard input[type=password]").fill("wrong-password-123");
    await page.locator(".meCard button.primary").first().click();
    await page.waitForTimeout(3500);
    log.push(`[${name}] login with wrong password -> ${await page.locator(".meCard .errorBar").last().textContent().catch(() => "no message")}`);
    await shot("02-me");

    // Пример поездки
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Открыть пример" }).click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    const tripUrl = page.url();
    await page.waitForTimeout(2500);
    await shot("03-trip-overview");
    await shot("03b-trip-overview-full", true);
    await page.getByRole("tab", { name: "Маршрут" }).click();
    await page.waitForTimeout(3000);
    await shot("04-trip-route");
    await page.locator(".storyCard", { hasText: "Кафе" }).first().click();
    await page.waitForTimeout(1200);
    await shot("05-point-modal");
    await page.getByRole("button", { name: "Дальше ›" }).click();
    await page.waitForTimeout(600);
    log.push(`[${name}] next point -> ${await page.locator(".premiumHero h3").textContent().catch(() => "?")}`);
    await page.locator(".sheetClose").click().catch(() => {});
    await page.waitForTimeout(400);
    await page.getByRole("tab", { name: "Моменты" }).click();
    await page.waitForTimeout(800);
    await shot("06-trip-moments");
    await page.locator(".momentRow", { hasText: "Метро" }).first().click();
    await page.waitForURL(/\/moment\/\?/, { timeout: 15000 });
    await page.waitForTimeout(3000);
    await shot("07-moment");

    // Новый момент → отдельное событие
    await page.goto(BASE + "/new/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Заметка" }).click();
    await page.locator(".placePicker input").fill("Сокольники");
    await page.waitForTimeout(2500);
    log.push(`[${name}] place suggestions: ${await page.locator(".suggestList li").count()}`);
    const sug = page.locator(".suggestList button").first();
    if (await sug.count()) await sug.click();
    await page.locator(".nmRow textarea").fill("Вышел погулять — а там фестиваль воздушных змеев!");
    await page.waitForTimeout(2500);
    log.push(`[${name}] weather: ${await page.locator(".nmValue").textContent().catch(() => "?")}`);
    await shot("08-new-moment");
    await page.locator(".nmBottomSave").click();
    await page.waitForURL(/\/moment\/\?/, { timeout: 20000 });
    await page.waitForTimeout(2500);
    await shot("09-event-moment");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    log.push(`[${name}] event after reload: ${await page.locator(".mText").textContent().catch(() => "MISSING")}`);

    for (const [path, n] of [["/", "10-home"], ["/map/", "11-map"], ["/timeline/", "12-timeline"], ["/photos/", "13-photos"], ["/videos/", "14-videos"]]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(path === "/map/" ? 5000 : 2500);
      await shot(n);
    }
    log.push(`[${name}] map markers: ${await page.goto(BASE + "/map/", { waitUntil: "networkidle" }).then(() => page.waitForTimeout(4000)).then(() => page.locator(".lmPin").count())}`);
    await page.goto(BASE + "/search/", { waitUntil: "networkidle" });
    await page.locator(".searchInput").fill("Ка");
    await page.waitForTimeout(800);
    log.push(`[${name}] search "Ка": ${await page.locator(".tripRow").count()} results`);
    await shot("15-search");
    await page.goto(tripUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
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

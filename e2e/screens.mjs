// Снимки экрана приложения в WebKit (движок Safari) с размерами iPhone и в Chromium (Android/ПК).
import { chromium, devices, webkit } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = "screens";
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
    await page.getByRole("button", { name: "Открыть пример" }).click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    await page.waitForTimeout(3500);
    await shot("2-trip");
    await shot("3-trip-full", true);
    await page.locator(".storyCard", { hasText: "Кафе" }).first().click();
    await page.waitForTimeout(700);
    await shot("4-point");
    await page.getByRole("button", { name: "Изменить" }).click();
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
    log.push(`[${name}] OK url=${page.url()} overflowX=${await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
  } catch (e) {
    log.push(`[${name}] FAILED: ${e.message}`);
    await shot("fail").catch(() => {});
  }
  await browser.close();
}

await run("iphone", webkit, devices["iPhone 13"]);
await run("android", chromium, devices["Pixel 7"]);
await run("desktop", chromium, { viewport: { width: 1280, height: 860 } });
fs.writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));

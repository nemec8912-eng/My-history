// Проверка новых функций: импорт из галереи по EXIF, статистика и регионы, корзина, работа без сети.
import { chromium, devices, webkit } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screens";
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, msg) => log.push(`[${name}] ${cond ? "PASS" : "FAIL"} ${msg}`);

/** Вставляет в JPEG блок EXIF с датой съёмки и GPS (как у фото с телефона). */
function withExif(jpeg, when, lat, lon) {
  const b = Buffer.alloc(178);
  b.write("MM", 0, "ascii");
  b.writeUInt16BE(42, 2);
  b.writeUInt32BE(8, 4);
  const entry = (o, tag, type, count, value) => {
    b.writeUInt16BE(tag, o);
    b.writeUInt16BE(type, o + 2);
    b.writeUInt32BE(count, o + 4);
    if (typeof value === "string") b.write(value, o + 8, "ascii");
    else b.writeUInt32BE(value, o + 8);
  };
  b.writeUInt16BE(2, 8); // IFD0
  entry(10, 0x8769, 4, 1, 38);
  entry(22, 0x8825, 4, 1, 76);
  b.writeUInt32BE(0, 34);
  b.writeUInt16BE(1, 38); // Exif IFD
  entry(40, 0x9003, 2, 20, 56);
  b.writeUInt32BE(0, 52);
  b.write(when + "\0", 56, "ascii");
  b.writeUInt16BE(4, 76); // GPS IFD
  entry(78, 1, 2, 2, lat >= 0 ? "N\0" : "S\0");
  entry(90, 2, 5, 3, 130);
  entry(102, 3, 2, 2, lon >= 0 ? "E\0" : "W\0");
  entry(114, 4, 5, 3, 154);
  b.writeUInt32BE(0, 126);
  const dms = (v, at) => {
    v = Math.abs(v);
    const d = Math.floor(v);
    const m = Math.floor((v - d) * 60);
    const s = Math.round(((v - d) * 60 - m) * 60 * 100);
    [[d, 1], [m, 1], [s, 100]].forEach(([n, den], i) => {
      b.writeUInt32BE(n, at + i * 8);
      b.writeUInt32BE(den, at + i * 8 + 4);
    });
  };
  dms(lat, 130);
  dms(lon, 154);
  const head = Buffer.alloc(10);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(2 + 6 + b.length, 2);
  head.write("Exif\0\0", 4, "binary");
  return Buffer.concat([jpeg.subarray(0, 2), head, b, jpeg.subarray(2)]);
}

async function run(name, browserType, device) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...device, locale: "ru-RU", serviceWorkers: "allow" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => log.push(`[${name}] pageerror: ${e.message}`));
  const shot = (n, full = false) => page.screenshot({ path: `${OUT}/feat-${name}-${n}.png`, fullPage: full }).catch(() => {});
  const trips = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          const r = indexedDB.open("my-history");
          r.onsuccess = () => {
            const g = r.result.transaction("kv", "readonly").objectStore("kv").get("trips");
            g.onsuccess = () => res(g.result || []);
            g.onerror = () => res([]);
          };
          r.onerror = () => res([]);
        })
    );
  const jpeg = async (color, text) =>
    Buffer.from(
      (
        await page.evaluate(
          ([c, t]) => {
            const cv = document.createElement("canvas");
            cv.width = 640;
            cv.height = 480;
            const x = cv.getContext("2d");
            x.fillStyle = c;
            x.fillRect(0, 0, 640, 480);
            x.fillStyle = "#fff";
            x.font = "bold 70px sans-serif";
            x.fillText(t, 40, 260);
            return cv.toDataURL("image/jpeg", 0.9);
          },
          [color, text]
        )
      ).split(",")[1],
      "base64"
    );

  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Открыть пример" }).first().click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    await page.waitForTimeout(1500);
    ok(name, (await page.locator(".modeLine").count()) === 1, `trip km by transport: "${(await page.locator(".modeLine").textContent().catch(() => ""))?.trim()}"`);
    const before = (await trips()).length;

    /* ── Импорт из галереи ── */
    await page.goto(BASE + "/new/", { waitUntil: "networkidle" });
    await page.locator(".impLink").click();
    await page.waitForURL(/\/import\//);
    const files = [
      { name: "IMG_1.jpg", buffer: withExif(await jpeg("#c0392b", "Кремль 1"), "2025:07:15 10:02:11", 55.7987, 49.1056) },
      { name: "IMG_2.jpg", buffer: withExif(await jpeg("#d35400", "Кремль 2"), "2025:07:15 10:25:40", 55.7991, 49.1061) },
      { name: "IMG_3.jpg", buffer: withExif(await jpeg("#27ae60", "Свияжск"), "2025:07:15 16:40:00", 55.7716, 48.6593) },
      { name: "IMG_4.jpg", buffer: withExif(await jpeg("#2980b9", "Нижний"), "2025:07:16 12:10:00", 56.3287, 44.0020) },
    ].map((f) => ({ ...f, mimeType: "image/jpeg" }));
    await page.locator('.importPage input[type="file"]').setInputFiles(files);
    await page.waitForSelector(".impCluster", { timeout: 15000 });
    await page.waitForTimeout(6000); // названия мест (1 запрос в секунду)
    const days = await page.locator(".impDay").count();
    const clusters = await page.locator(".impCluster").count();
    const hint = await page.locator(".impHint").textContent();
    ok(name, days === 2 && clusters === 3, `import plan: ${days} days, ${clusters} moments; ${hint?.trim()}`);
    ok(name, /найдена у 4, место — у 4/.test(hint ?? ""), "EXIF date and GPS read from all 4 photos");
    const titles = await page.locator(".impHead strong").allTextContents();
    log.push(`[${name}] import places: ${titles.join(" | ")}`);
    await shot("1-import", true);
    await page.locator(".nmBottomSave").click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const afterImport = await trips();
    const imported = afterImport.filter((t) => t.meta?.kind === "event" && t.date.startsWith("2025-07-1"));
    const cps = imported.flatMap((t) => t.checkpoints);
    ok(
      name,
      afterImport.length === before + 2 && imported.length === 2 && cps.length === 3 && cps.every((c) => c.location && c.mediaIds.length && c.coverMediaId),
      `import saved: trips ${before}→${afterImport.length}, events=${imported.length}, moments=${cps.length}, times=${cps.map((c) => c.meta?.date + " " + c.time).join(", ")}`
    );
    await shot("2-imported");

    /* ── Статистика и регионы ── */
    await page.goto(BASE + "/stats/", { waitUntil: "networkidle" });
    await page.waitForTimeout(12000);
    const regions = await page.locator(".regionList li strong").allTextContents();
    ok(name, regions.some((r) => /Татарстан/.test(r)) && regions.some((r) => /Нижегород/.test(r)), `regions: ${regions.join(" | ")}`);
    const areas = await page.locator(".regionsMap path.leaflet-interactive, .regionsMap svg path").count();
    ok(name, areas > 0, `region shapes on map: ${areas}`);
    const tiles = await page.locator(".statTile").allTextContents();
    log.push(`[${name}] stats: ${tiles.join(" | ")}`);
    await shot("3-stats", true);

    /* ── Корзина ── */
    const nn = imported.find((t) => t.checkpoints.some((c) => c.location.lat > 56));
    await page.goto(BASE + `/moment/?trip=${nn.id}&cp=${nn.checkpoints[0].id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.locator(".sheet .dangerBtn").click();
    await page.waitForTimeout(1500);
    let t3 = await trips();
    ok(name, t3.find((t) => t.id === nn.id)?.meta?.deletedAt, "deleted event moved to trash (kept with deletedAt)");
    await page.goto(BASE + "/timeline/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const tlHidden = !(await page.locator("main").textContent()).includes(nn.title) || imported.some((t) => t.id !== nn.id && t.title === nn.title);
    ok(name, tlHidden, "trashed event hidden from timeline");
    await page.goto(BASE + "/me/", { waitUntil: "networkidle" });
    await page.locator(".meLinks a", { hasText: "Корзина" }).click();
    await page.waitForURL(/\/trash\//);
    await page.waitForSelector(".trashItem", { timeout: 10000 });
    ok(name, (await page.locator(".trashItem").count()) === 1, `trash shows: ${(await page.locator(".trashItem strong").allTextContents()).join(", ")}`);
    await shot("4-trash");
    await page.getByRole("button", { name: "Восстановить" }).click();
    await page.waitForTimeout(1200);
    t3 = await trips();
    ok(name, (await page.locator(".trashItem").count()) === 0 && !t3.find((t) => t.id === nn.id)?.meta?.deletedAt, "restored from trash");
    // удалить снова и навсегда
    await page.goto(BASE + `/moment/?trip=${nn.id}&cp=${nn.checkpoints[0].id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.locator(".sheet .dangerBtn").click();
    await page.waitForTimeout(1200);
    await page.goto(BASE + "/trash/", { waitUntil: "networkidle" });
    await page.waitForSelector(".trashItem", { timeout: 10000 });
    await page.getByRole("button", { name: "Удалить навсегда" }).click();
    await page.waitForTimeout(1200);
    t3 = await trips();
    ok(name, !t3.some((t) => t.id === nn.id) && (await page.locator(".trashItem").count()) === 0, "purged permanently after confirmation");

    /* ── Без сети ── */
    await page.goto(BASE + "/new/", { waitUntil: "networkidle" });
    await page.evaluate(() => navigator.serviceWorker?.ready).catch(() => undefined);
    await page.waitForTimeout(1500);
    await ctx.setOffline(true);
    await page.waitForTimeout(800);
    const bar = await page.locator(".offlineBar").textContent().catch(() => null);
    ok(name, Boolean(bar && /Нет сети/.test(bar)), `offline bar: "${bar}"`);
    await page.locator(".typeTabs button", { hasText: "Заметка" }).click();
    await page.locator(".newMoment textarea").fill("Записано без интернета");
    await page.getByRole("button", { name: "Сохранить момент" }).click();
    await page.waitForTimeout(4000);
    const saved = (await trips()).some((t) => t.checkpoints.some((c) => c.description === "Записано без интернета"));
    ok(name, saved, `note saved offline (url=${page.url().replace(BASE, "")})`);
    await shot("5-offline");
    await ctx.setOffline(false);
    await page.waitForTimeout(1500);
    ok(name, (await page.locator(".offlineBar").count()) === 0, "offline bar hidden when back online");
    log.push(`[${name}] OK overflowX=${await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
  } catch (e) {
    log.push(`[${name}] FAILED: ${e.message.split("\n")[0]}`);
    await shot("fail");
  }
  await browser.close();
}

await run("iphone", webkit, devices["iPhone 13"]);
await run("android", chromium, devices["Pixel 7"]);
await run("desktop", chromium, { viewport: { width: 1280, height: 860 } });
fs.appendFileSync(`${OUT}/log.txt`, "\n" + log.join("\n") + "\n");
console.log(log.join("\n"));

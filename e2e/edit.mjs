// Сквозной тест редактирования события и момента поездки (настоящие файлы фото, сохранение, перезагрузка).
import { chromium, devices, webkit } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screens";
const ONLY = process.env.ONLY;
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, msg) => log.push(`[${name}] ${cond ? "PASS" : "FAIL"} ${msg}`);

async function run(name, browserType, device) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...device, locale: "ru-RU", permissions: [] });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => log.push(`[${name}] pageerror: ${e.message}`));
  const shot = (n, full = false) => page.screenshot({ path: `${OUT}/edit-${name}-${n}.png`, fullPage: full }).catch(() => {});

  const jpeg = async (color, text) =>
    Buffer.from(
      (
        await page.evaluate(
          ([c, t]) => {
            const cv = document.createElement("canvas");
            cv.width = 800;
            cv.height = 600;
            const x = cv.getContext("2d");
            x.fillStyle = c;
            x.fillRect(0, 0, 800, 600);
            x.fillStyle = "#fff";
            x.font = "bold 90px sans-serif";
            x.fillText(t, 60, 330);
            return cv.toDataURL("image/jpeg", 0.9);
          },
          [color, text]
        )
      ).split(",")[1],
      "base64"
    );

  const trips = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          const r = indexedDB.open("my-history");
          r.onsuccess = () => {
            try {
              const g = r.result.transaction("kv", "readonly").objectStore("kv").get("trips");
              g.onsuccess = () => res(g.result || []);
              g.onerror = () => res([]);
            } catch {
              res([]);
            }
          };
          r.onerror = () => res([]);
        })
    );

  const pickPlace = async (scope, query) => {
    const input = page.locator(`${scope} .placePicker input`).first();
    await input.fill("");
    await input.type(query, { delay: 30 });
    await page.locator(`${scope} .suggestList button`).first().waitFor({ timeout: 15000 });
    const label = await page.locator(`${scope} .suggestList button strong`).first().textContent();
    await page.locator(`${scope} .suggestList button`).first().click();
    return label;
  };

  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Открыть пример" }).first().click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });

    /* ── 1–3. Создать событие с описанием, датой, временем, местом и фото ── */
    await page.goto(BASE + "/new/", { waitUntil: "networkidle" });
    await page.locator(".typeTabs button", { hasText: "Фото" }).click();
    await page.locator('.newMoment input[type="file"]').first().setInputFiles({ name: "red.jpg", mimeType: "image/jpeg", buffer: await jpeg("#c0392b", "ФОТО 1") });
    await page.waitForTimeout(2500);
    const place1 = await pickPlace(".newMoment", "Казанский кремль");
    await page.locator('input[type="datetime-local"]').fill("2025-07-15T14:30");
    await page.locator(".newMoment textarea").fill("Первое описание события");
    await page.locator('.newMoment input[placeholder^="Название"]').fill("Тестовое событие");
    await page.locator(".newMoment select").selectOption("event");
    await page.getByRole("button", { name: "Сохранить момент" }).click();
    await page.waitForURL(/\/moment\/\?/, { timeout: 20000 });
    const url1 = new URL(page.url());
    const tripId = url1.searchParams.get("trip");
    const cpId = url1.searchParams.get("cp");
    await page.waitForTimeout(2500);
    await shot("1-created");
    const before = await trips();
    ok(name, true, `created event trip=${tripId?.slice(0, 8)} cp=${cpId?.slice(0, 8)} place="${place1}" trips=${before.length}`);

    /* ── 4. Снова открыть ── */
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    ok(name, (await page.locator(".mText").textContent())?.includes("Первое описание"), "event reopened after reload");

    /* ── 5–11. Редактировать ── */
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.waitForTimeout(800);
    await page.locator(".sheet textarea").first().fill("Изменённое описание после редактирования");
    await page.locator('.sheet input[type="date"]').first().fill("2024-05-09");
    await page.locator('.sheet input[type="time"]').first().fill("10:15");
    const place2 = await pickPlace(".sheet", "Нижегородский кремль");
    await page.waitForTimeout(800);
    // точка на карте: открываем карту и проверяем, что метка стоит
    await page.getByRole("button", { name: /Уточнить точку на карте/ }).click();
    await page.waitForTimeout(2500);
    ok(name, (await page.locator(".sheet .mapPickerCanvas .lmPin").count()) === 1, "map point picker shows marker");
    await page.locator('.sheet .mediaPicker input[accept="image/*"]').first().setInputFiles({ name: "blue.jpg", mimeType: "image/jpeg", buffer: await jpeg("#2f7bff", "ФОТО 2") });
    await page.waitForTimeout(3000);
    const cellsBefore = await page.locator(".sheet .mediaCell").count();
    await page.locator(".sheet .mediaCell").first().click();
    await page.waitForTimeout(800);
    await page.locator(".lightbox").getByRole("button", { name: "Удалить" }).click();
    await page.waitForTimeout(800);
    await page.locator(".lightboxClose").click().catch(() => {});
    const cellsAfter = await page.locator(".sheet .mediaCell").count();
    ok(name, cellsBefore === 2 && cellsAfter === 1, `photos in editor ${cellsBefore} → ${cellsAfter}`);
    await shot("2-editor");
    await page.locator('.sheet button[type="submit"]').click();
    await page.waitForTimeout(2500);

    /* ── 12–13. Перезагрузить и проверить ── */
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const url2 = new URL(page.url());
    ok(name, url2.searchParams.get("cp") === cpId && url2.searchParams.get("trip") === tripId, "same event id after edit");
    const desc = await page.locator(".mText").textContent();
    const dateTxt = await page.locator(".mDate span").last().textContent();
    const placeTxt = await page.locator(".mPlace strong").textContent();
    ok(name, desc?.includes("Изменённое описание"), `description="${desc}"`);
    ok(name, dateTxt?.includes("9 мая 2024") && dateTxt?.includes("10:15"), `date="${dateTxt}"`);
    ok(name, Boolean(placeTxt) && !/Казан/i.test(placeTxt), `place="${placeTxt}" (picked "${place2}")`);
    const cells = page.locator(".momentBody .mediaGallery .mediaCell");
    const n = await cells.count();
    const imgOk = n ? await cells.first().locator("img").evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false) : false;
    ok(name, n === 1 && imgOk, `media after reload: ${n} photo(s), displayed=${imgOk}`);
    const after = await trips();
    const ev = after.find((t) => t.id === tripId);
    ok(name, after.length === before.length && ev?.checkpoints.length === 1 && ev.checkpoints[0].id === cpId, `no duplicates: trips ${before.length}→${after.length}, event moments=${ev?.checkpoints.length}`);
    ok(name, ev?.date === "2024-05-09" && ev?.title === "Тестовое событие", `event date=${ev?.date} title=${ev?.title}`);
    const loc = ev?.checkpoints[0].location;
    ok(name, loc && loc.lat > 56 && loc.lat < 56.5 && loc.lon > 43.8 && loc.lon < 44.2, `coords ${loc?.lat?.toFixed(4)}, ${loc?.lon?.toFixed(4)} (Нижний Новгород)`);
    ok(name, Boolean(ev?.checkpoints[0].meta?.address || ev?.checkpoints[0].location?.label), `address="${ev?.checkpoints[0].meta?.address ?? ""}"`);
    await shot("3-after-reload");

    /* ── 14. Карта ── */
    await page.goto(BASE + "/map/", { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    const labels = await page.locator(".lmLabel").allTextContents();
    ok(name, labels.some((l) => /Нижегор|Нижн|кремл/i.test(l)) && !labels.some((l) => /Казан/i.test(l)), `map labels: ${labels.join(" | ")}`);
    await shot("4-map");

    /* ── 15. Хронология ── */
    await page.goto(BASE + "/timeline/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const sec2024 = await page.locator(".tlSection", { hasText: "2024" }).textContent().catch(() => "");
    const sec2025 = await page.locator(".tlSection", { hasText: "2025" }).textContent().catch(() => "");
    ok(name, sec2024.includes("Тестовое событие") && sec2024.includes("Май") && !sec2025.includes("Тестовое событие"), "timeline: event moved to May 2024");
    await shot("5-timeline", true);

    /* ── 16. Фото / поиск ── */
    await page.goto(BASE + "/photos/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const photosTxt = await page.locator("main").textContent();
    ok(name, /Май 2024/.test(photosTxt), "photos grouped under Май 2024");
    await page.goto(BASE + "/search/", { waitUntil: "networkidle" });
    await page.locator('input[type="search"]').first().fill("Изменённое");
    await page.waitForTimeout(1500);
    ok(name, (await page.locator("main").textContent()).includes("Тестовое событие"), "search finds edited description");

    /* ── Момент внутри поездки ── */
    const all = await trips();
    const demo = all.find((t) => t.title.includes("пример"));
    const cafe = demo?.checkpoints.find((c) => c.title === "Кафе");
    await page.goto(BASE + `/moment/?trip=${demo.id}&cp=${cafe.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.waitForTimeout(600);
    await page.locator(".sheet textarea").first().fill("Завтрак — отредактировано");
    await page.locator('.sheet input[type="time"]').first().fill("10:40");
    await page.locator('.sheet button[type="submit"]').click();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const d2 = await page.locator(".mText").textContent();
    const after2 = await trips();
    const demo2 = after2.find((t) => t.id === demo.id);
    ok(
      name,
      d2?.includes("отредактировано") && demo2.checkpoints.length === demo.checkpoints.length && demo2.checkpoints.find((c) => c.id === cafe.id)?.time === "10:40",
      `trip moment edited in place: points ${demo.checkpoints.length}→${demo2.checkpoints.length}`
    );
    await shot("6-trip-moment");

    /* ── Удаление с подтверждением ── */
    await page.goto(BASE + `/moment/?trip=${tripId}&cp=${cpId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.waitForTimeout(600);
    await page.locator(".sheet .dangerBtn").click();
    await page.waitForURL((u) => !u.search.includes(cpId), { timeout: 10000 });
    const after3 = await trips();
    ok(name, !after3.some((t) => t.id === tripId) && after3.length === all.length - 1, "deleting the only moment removes the event (after confirmation)");
    log.push(`[${name}] OK overflowX=${await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
  } catch (e) {
    log.push(`[${name}] FAILED: ${e.message.split("\n")[0]}`);
    await shot("fail");
  }
  await browser.close();
}

if (!ONLY || ONLY.includes("iphone")) await run("iphone", webkit, devices["iPhone 13"]);
if (!ONLY || ONLY.includes("android")) await run("android", chromium, devices["Pixel 7"]);
if (!ONLY || ONLY.includes("desktop")) await run("desktop", chromium, { viewport: { width: 1280, height: 860 } });
fs.appendFileSync(`${OUT}/log.txt`, "\n" + log.join("\n") + "\n");
console.log(log.join("\n"));

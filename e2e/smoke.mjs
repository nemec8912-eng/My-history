// Полный обход приложения на iPhone, Android и компьютере: каждый экран открывается без ошибок,
// ничего не вылезает за ширину экрана, на экране нет «undefined»/«NaN», «Назад» возвращает туда, откуда пришли.
import { chromium, devices, webkit } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screens";
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, msg) => log.push(`[${name}] ${cond ? "PASS" : "FAIL"} ${msg}`);

async function run(name, browserType, device) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...device, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Внешние сервисы без сети в тестовой среде и отказ облака без входа — не ошибки приложения.
    if (/Failed to load resource|ERR_|net::|tile\.openstreetmap|arcgisonline|status of 4\d\d/i.test(t)) return;
    errors.push(`console: ${t.slice(0, 160)}`);
  });
  const trips = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          const r = indexedDB.open("my-history");
          r.onsuccess = () => {
            const g = r.result.transaction("kv", "readonly").objectStore("kv").get("trips");
            g.onsuccess = () => res(g.result || []);
          };
        })
    );
  const check = async (label, url, { full = true } = {}) => {
    errors.length = 0;
    await page.goto(BASE + url, { waitUntil: "load" });
    await page.waitForTimeout(2200);
    const r = await page.evaluate(() => {
      const W = window.innerWidth;
      const over = document.documentElement.scrollWidth > W + 1;
      // элементы, вылезающие за правый край (кроме содержимого горизонтальных лент и карты)
      const bad = [];
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none") continue;
        if (el.closest(".hScroll, .tagFilter, .yearChips, .tnRow, .leaflet-container, .tabsRow, .segRow, .tagChips, .impThumbs, .recapStage, .storyRoute, .journeyStrip, .momentHero, .tripHero")) continue;
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > W + 2) bad.push(`${el.tagName.toLowerCase()}.${(el.className && el.className.baseVal === undefined ? el.className : "").toString().split(" ")[0]}`);
      }
      const text = document.body.innerText;
      const junk = (text.match(/\b(undefined|NaN|null|\[object Object\])\b/g) || []).slice(0, 3);
      return { over, bad: Array.from(new Set(bad)).slice(0, 4), junk, h1: document.querySelector("h1")?.textContent?.trim() };
    });
    ok(name, !r.over && r.bad.length === 0, `${label}: no horizontal overflow${r.bad.length ? " — sticking out: " + r.bad.join(", ") : ""}`);
    ok(name, r.junk.length === 0, `${label}: no undefined/NaN text${r.junk.length ? " — " + r.junk.join(", ") : ""}`);
    ok(name, errors.length === 0, `${label}: no errors${errors.length ? " — " + errors.slice(0, 2).join(" | ") : ""}`);
    await page.screenshot({ path: `${OUT}/smoke-${name}-${label}.png`, fullPage: full }).catch(() => {});
    return r;
  };

  try {
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    await check("home-empty", "/");
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Открыть пример" }).first().click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    const tripId = new URL(page.url()).searchParams.get("id");
    await page.waitForTimeout(1500);
    const all = await trips();
    const demo = all.find((t) => t.id === tripId);
    const end = demo.checkpoints.find((c) => c.kind === "end");
    const reg = demo.checkpoints.filter((c) => c.kind === "regular");

    const pages = [
      ["home", "/"],
      ["trip", `/trip/?id=${tripId}`],
      ["moment", `/moment/?trip=${tripId}&cp=${reg[0].id}`],
      ["moment-last", `/moment/?trip=${tripId}&cp=${reg[reg.length - 1].id}`],
      ["place", `/place/?trip=${tripId}&cp=${end.id}`],
      ["map", "/map/"],
      ["timeline", "/timeline/"],
      ["photos", "/photos/"],
      ["videos", "/videos/"],
      ["albums", "/albums/"],
      ["search", "/search/"],
      ["me", "/me/"],
      ["new", "/new/"],
      ["import", "/import/"],
      ["trash", "/trash/"],
      ["stats", "/stats/"],
      ["year", `/year/?y=${new Date().getFullYear()}`],
      ["achievements", "/achievements/"],
      ["wishes", "/wishes/"],
      ["plan-pack", `/plan/?trip=${tripId}&tab=pack`],
      ["plan-money", `/plan/?trip=${tripId}&tab=money`],
      ["plan-docs", `/plan/?trip=${tripId}&tab=docs`],
      ["recap", `/recap/?trip=${tripId}`],
      ["book", `/book/?trip=${tripId}`],
      ["nearby", "/nearby/?lat=55.7612&lon=37.5772"],
      ["gdrive", "/gdrive/"],
      ["moment-missing", `/moment/?trip=${tripId}&cp=nope`],
      ["trip-missing", "/trip/?id=nope"],
      ["album-missing", "/album/?id=nope"],
    ];
    for (const [label, url] of pages) {
      try {
        await check(label, url, { full: !["map"].includes(label) });
      } catch (e) {
        log.push(`[${name}] FAIL ${label}: ${e.message.split("\n")[0]}`);
      }
    }

    /* ── Заголовок момента виден ── */
    await page.goto(BASE + `/moment/?trip=${tripId}&cp=${reg[0].id}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    ok(name, (await page.locator(".mTitle").textContent())?.trim() === reg[0].title, `moment title shown: "${reg[0].title}"`);

    /* ── «Назад» возвращает в хронологию ── */
    await page.goto(BASE + "/timeline/", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.locator(".tlTrip").first().click();
    await page.waitForURL(/\/trip\//);
    await page.waitForTimeout(800);
    await page.locator(".heroBar .roundBtn").first().click();
    await page.waitForTimeout(1200);
    ok(name, /\/timeline\//.test(page.url()), `back from trip returns to timeline (${page.url().replace(BASE, "")})`);

    /* ── Новая точка без сохранения не остаётся ── */
    await page.goto(BASE + `/trip/?id=${tripId}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    const before = (await trips()).find((t) => t.id === tripId).checkpoints.length;
    const add = page.getByRole("button", { name: /Добавить точку/ }).first();
    if (await add.count()) {
      await page.getByRole("tab", { name: "Маршрут" }).click().catch(() => {});
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /Добавить точку/ }).first().click();
      await page.waitForTimeout(800);
      await page.locator(".sheet").getByRole("button", { name: "Отмена" }).click();
      await page.waitForTimeout(1200);
      const after = (await trips()).find((t) => t.id === tripId).checkpoints.length;
      ok(name, after === before, `cancelled new point is not kept: ${before} → ${after}`);
    } else log.push(`[${name}] note: no "Добавить точку" button found`);

    /* ── Черновик: выход спрашивает подтверждение ── */
    let asked = false;
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => {
      if (/Выйти без сохранения/.test(d.message())) asked = true;
      d.dismiss();
    });
    await page.goto(BASE + "/new/", { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.locator(".newMoment textarea").fill("черновик");
    await page.locator(".nmHead a").first().click();
    await page.waitForTimeout(600);
    ok(name, asked && /\/new\//.test(page.url()), "leaving a draft asks for confirmation and stays");
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => d.accept());

    log.push(`[${name}] OK done`);
  } catch (e) {
    log.push(`[${name}] FAILED: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${OUT}/smoke-${name}-fail.png` }).catch(() => {});
  }
  await browser.close();
}

await run("iphone", webkit, devices["iPhone 13"]);
await run("android", chromium, devices["Pixel 7"]);
await run("desktop", chromium, { viewport: { width: 1280, height: 860 } });
fs.appendFileSync(`${OUT}/log.txt`, "\n" + log.join("\n") + "\n");
console.log(log.join("\n"));

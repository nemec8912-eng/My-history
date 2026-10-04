// Проверка второго пакета: метки, быстрый момент, GPX, поделиться, видео-итог, итоги года, архив, очистка, замок, диктовка.
import { chromium, devices, webkit } from "playwright";
import fs from "node:fs";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screens";
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, msg) => log.push(`[${name}] ${cond ? "PASS" : "FAIL"} ${msg}`);

const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>
${Array.from({ length: 60 }, (_, i) => `<trkpt lat="${(55.75 + i * 0.002).toFixed(5)}" lon="${(37.6 + Math.sin(i / 5) * 0.004 + i * 0.001).toFixed(5)}"><time>2026-06-01T10:${String(i).padStart(2, "0")}:00Z</time></trkpt>`).join("\n")}
</trkseg></trk></gpx>`;

async function run(name, browserType, device) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({
    ...device,
    locale: "ru-RU",
    acceptDownloads: true,
    permissions: browserType === webkit ? [] : ["geolocation"],
    geolocation: { latitude: 55.7963, longitude: 49.1088 },
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => log.push(`[${name}] pageerror: ${e.message}`));
  const shot = (n, full = false) => page.screenshot({ path: `${OUT}/feat2-${name}-${n}.png`, fullPage: full }).catch(() => {});
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
  let step = "start";
  try {
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Открыть пример" }).first().click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    const tripId = new URL(page.url()).searchParams.get("id");
    await page.waitForTimeout(1500);

    /* ── Метки ── */
    step = "tags";
    let all = await trips();
    const demo = all.find((t) => t.id === tripId);
    const cafe = demo.checkpoints.find((c) => c.title === "Кафе");
    await page.goto(BASE + `/moment/?trip=${tripId}&cp=${cafe.id}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Редактировать/ }).click();
    const tagInput = page.locator(".sheet .tagInput input");
    await tagInput.fill("Завтрак");
    await tagInput.press("Enter");
    await tagInput.fill("семья, Москва");
    await tagInput.press("Enter");
    await page.locator('.sheet button[type="submit"]').click();
    await page.waitForTimeout(1500);
    all = await trips();
    const tags = all.find((t) => t.id === tripId).checkpoints.find((c) => c.id === cafe.id).meta?.tags;
    ok(name, JSON.stringify(tags) === JSON.stringify(["завтрак", "семья", "москва"]), `tags saved: ${JSON.stringify(tags)}`);
    ok(name, (await page.locator(".mTags .tagChip").count()) === 3, "tags shown on moment");
    await page.locator(".mTags .tagChip", { hasText: "#завтрак" }).click();
    await page.waitForURL(/\/timeline\/\?tag=/);
    await page.waitForTimeout(1200);
    const onChip = await page.locator(".tagFilter .tagChip.on").textContent();
    ok(name, /завтрак/.test(onChip ?? "") && (await page.locator(".tlTrip").count()) === 1, `timeline filtered by tag: "${onChip?.trim()}", trips=${await page.locator(".tlTrip").count()}`);
    await page.goto(BASE + "/search/", { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.locator(".tagChip", { hasText: "#семья" }).click();
    await page.waitForTimeout(800);
    ok(name, (await page.locator(".tripRows").first().textContent())?.includes("Кафе") || (await page.locator("main").textContent()).includes("Кафе"), "search by tag finds the moment");
    await page.goto(BASE + "/map/", { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const before = await page.locator(".lmIcon").count();
    await page.locator(".mapTags .tagChip", { hasText: "#москва" }).click();
    await page.waitForTimeout(1500);
    const afterF = await page.locator(".lmIcon").count();
    const expect = cafe.location && (cafe.location.lat || cafe.location.lon) ? 1 : 0;
    ok(name, afterF === expect && before > afterF, `map tag filter: markers ${before} → ${afterF} (tagged moment has ${expect ? "a place" : "no place"})`);
    await shot("1-map-tag");

    /* ── GPX ── */
    step = "gpx";
    await page.goto(BASE + `/trip/?id=${tripId}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.locator('.tripActions input[type="file"]').setInputFiles({ name: "track.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(GPX) });
    await page.waitForTimeout(1500);
    all = await trips();
    const route = all.find((t) => t.id === tripId).route;
    ok(name, route?.provider === "gpx" && route.distance > 5000 && route.segments[0].path[0].length === 60, `GPX track saved: ${route?.distance} m, ${route?.segments[0].path[0].length} points`);
    const kmTile = await page.locator(".statTile", { hasText: "км" }).first().textContent();
    ok(name, /\d/.test(kmTile ?? ""), `km tile uses track: "${kmTile}"`);
    await shot("2-gpx");

    /* ── Поделиться ── */
    step = "share";
    if (name === "desktop") {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.locator(".tripActions .taBtn", { hasText: "Поделиться" }).click()]);
      const p = await dl.path();
      const html = fs.readFileSync(p, "utf8");
      ok(name, html.includes("<!doctype html>") && html.includes("Поездка в зоопарк") && html.includes("Кафе"), `share HTML: ${dl.suggestedFilename()} ${Math.round(html.length / 1024)} KB`);
      fs.copyFileSync(p, `${OUT}/feat2-share.html`);
    }

    /* ── Видео-итог ── */
    step = "recap";
    // Добавим фото в момент, чтобы было из чего собирать ролик.
    const jpg = Buffer.from(
      (
        await page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = 800;
          c.height = 600;
          const x = c.getContext("2d");
          x.fillStyle = "#16a085";
          x.fillRect(0, 0, 800, 600);
          x.fillStyle = "#fff";
          x.font = "bold 80px sans-serif";
          x.fillText("Зоопарк", 150, 330);
          return c.toDataURL("image/jpeg", 0.9);
        })
      ).split(",")[1],
      "base64"
    );
    await page.goto(BASE + `/moment/?trip=${tripId}&cp=${cafe.id}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    await page.locator('.momentBody .mediaPicker input[accept="image/*"]').setInputFiles({ name: "zoo.jpg", mimeType: "image/jpeg", buffer: jpg });
    await page.waitForTimeout(2500);
    await page.goto(BASE + `/trip/?id=${tripId}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    await page.locator(".taBtn", { hasText: "Видео-итог" }).click();
    await page.waitForURL(/\/recap\//);
    await page.waitForSelector(".recapActions", { timeout: 20000 });
    await page.getByRole("button", { name: /Смотреть/ }).click();
    await page.waitForTimeout(3500);
    await shot("3-recap");
    const painted = await page.evaluate(() => {
      const c = document.querySelector(".recapStage canvas");
      const d = c.getContext("2d").getImageData(360, 640, 1, 1).data;
      return d[0] + d[1] + d[2] > 30;
    });
    ok(name, painted, "recap canvas plays");
    if (name === "desktop") {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Сохранить видео" }).click()]);
      const size = fs.statSync(await dl.path()).size;
      ok(name, size > 20000, `recap video saved: ${dl.suggestedFilename()} ${Math.round(size / 1024)} KB`);
    }

    /* ── Быстрый момент ── */
    step = "quick";
    if (browserType !== webkit) {
      await page.goto(BASE + "/new/?quick=1", { waitUntil: "load" });
      await page.waitForTimeout(4000);
      const note = await page.locator(".okBar").first().textContent();
      const placeVal = await page.locator(".placePicker input").first().inputValue();
      ok(name, /заполнены/.test(note ?? "") && /Казан/.test(placeVal), `quick moment: "${note}" place="${placeVal}"`);
      ok(name, (await page.locator('.nmDrop input[capture="environment"]').count()) === 1, "quick moment opens camera");
    }

    /* ── Итоги года ── */
    step = "year";
    const y = String(new Date().getFullYear());
    await page.goto(BASE + `/year/?y=${y}`, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const big = await page.locator(".yrBig").textContent().catch(() => "");
    ok(name, Number(big) >= 8 && (await page.locator(".yrMonth").count()) === 12, `year recap ${y}: ${big} moments`);
    await shot("4-year", true);

    /* ── Архив, восстановление, очистка ── */
    step = "archive";
    await page.goto(BASE + "/me/", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    ok(name, (await page.locator(".meTools .settingsRow", { hasText: "Напоминания" }).count()) === 1, "reminders toggle present");
    if (name === "desktop") {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.locator(".settingsRow", { hasText: "с превью фото" }).click()]);
      const p = await dl.path();
      const arc = JSON.parse(fs.readFileSync(p, "utf8"));
      ok(name, arc.app === "my-history" && arc.trips.length >= 1 && arc.media.some((m) => m.thumb?.startsWith("data:image")), `archive: ${arc.trips.length} trips, ${arc.media.length} files`);
      // восстановление в «чистый» браузер
      const ctx2 = await browser.newContext({ locale: "ru-RU" });
      const p2 = await ctx2.newPage();
      p2.on("dialog", (d) => d.accept());
      await p2.goto(BASE + "/me/", { waitUntil: "load" });
      await p2.waitForTimeout(1200);
      await p2.locator('.meTools input[type="file"]').setInputFiles(p);
      await p2.waitForSelector(".meTools .okBar", { timeout: 20000 });
      const msg = await p2.locator(".meTools .okBar").textContent();
      await p2.goto(BASE + "/timeline/", { waitUntil: "load" });
      await p2.waitForTimeout(1500);
      ok(name, /Восстановлено: [1-9]/.test(msg) && (await p2.locator(".tlTrip").count()) >= 1, `restore into clean browser: "${msg}"`);
      await ctx2.close();
    }
    await page.locator(".settingsRow", { hasText: "Найти файлы" }).click();
    await page.waitForTimeout(1500);
    const scanMsg = await page.locator(".meTools .okBar, .meTools .orphanBox").first().textContent().catch(() => "");
    ok(name, /нет|Найдено/.test(scanMsg), `orphan scan: "${scanMsg?.slice(0, 80)}"`);

    /* ── Замок (виртуальный Face ID в Chromium) ── */
    step = "lock";
    if (name === "desktop") {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(1500);
      const row = page.locator(".settingsRow", { hasText: "Face ID" });
      ok(name, (await row.count()) === 1, "Face ID lock option shown when device supports it");
      await row.click();
      await page.waitForTimeout(1000);
      const lockMsg = await page.locator(".meTools .errorBar, .meTools .okBar").first().textContent().catch(() => "");
      ok(name, /войдите в аккаунт/.test(lockMsg), `lock requires account (password fallback): "${lockMsg}"`);
    }

    /* ── Диктовка ── */
    step = "voice";
    await page.goto(BASE + "/new/", { waitUntil: "load" });
    await page.waitForTimeout(800);
    const voice = await page.locator(".voiceBtn").count();
    log.push(`[${name}] voice dictation button: ${voice ? "shown" : "hidden (browser has no speech recognition)"}`);

    /* ── Границы регионов ── */
    step = "regions";
    await page.goto(BASE + "/stats/", { waitUntil: "load" });
    await page.waitForTimeout(9000);
    const info = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".regionsMap svg path")).slice(0, 3).map((p) => {
        const r = p.getBoundingClientRect();
        return `${p.getAttribute("fill")}/${p.getAttribute("fill-opacity")} d=${(p.getAttribute("d") || "").length} ${Math.round(r.width)}x${Math.round(r.height)}`;
      })
    );
    ok(name, info.some((s) => !/ 0x0$/.test(s) && !/d=0/.test(s)), `region shapes: ${info.join(" | ")}`);
    await shot("5-stats", true);
    log.push(`[${name}] OK overflowX=${await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
  } catch (e) {
    log.push(`[${name}] FAILED at ${step}: ${e.message.split("\n")[0]}`);
    await shot("fail");
  }
  await browser.close();
}

await run("iphone", webkit, devices["iPhone 13"]);
await run("android", chromium, devices["Pixel 7"]);
await run("desktop", chromium, { viewport: { width: 1280, height: 860 } });
fs.appendFileSync(`${OUT}/log.txt`, "\n" + log.join("\n") + "\n");
console.log(log.join("\n"));

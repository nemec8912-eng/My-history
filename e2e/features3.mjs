// Третий пакет: настроение, оценка, «Лучшее», коллаж, сборы/расходы/документы, «Хочу поехать», альбомы,
// «Тогда и сейчас», достижения, тепловая карта, «Интересное рядом», фотокнига, импорт Google Takeout.
import { chromium, devices, webkit } from "playwright";
import fs from "node:fs";
import zlib from "node:zlib";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "screens";
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, msg) => log.push(`[${name}] ${cond ? "PASS" : "FAIL"} ${msg}`);

/* ── Мини-ZIP (как архив Google Takeout): фото без сжатия + описание .json со сжатием deflate ── */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const method = f.deflate ? 8 : 0;
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

async function run(name, browserType, device) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ ...device, locale: "ru-RU", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(d.defaultValue() || "Тест") : d.accept()));
  page.on("pageerror", (e) => log.push(`[${name}] pageerror: ${e.message}`));
  const shot = (n, full = false) => page.screenshot({ path: `${OUT}/feat3-${name}-${n}.png`, fullPage: full }).catch(() => {});
  const idb = (fn, arg) => page.evaluate(fn, arg);
  const trips = () =>
    idb(
      () =>
        new Promise((res) => {
          const r = indexedDB.open("my-history");
          r.onsuccess = () => {
            const g = r.result.transaction("kv", "readonly").objectStore("kv").get("trips");
            g.onsuccess = () => res(g.result || []);
          };
        })
    );
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
            x.font = "bold 80px sans-serif";
            x.fillText(t, 60, 330);
            return cv.toDataURL("image/jpeg", 0.9);
          },
          [color, text]
        )
      ).split(",")[1],
      "base64"
    );
  let step = "start";
  try {
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.getByRole("button", { name: "Открыть пример" }).first().click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    const tripId = new URL(page.url()).searchParams.get("id");
    await page.waitForTimeout(1500);
    let all = await trips();
    const demo = all.find((t) => t.id === tripId);
    const cafe = demo.checkpoints.find((c) => c.title === "Кафе");
    const placed = demo.checkpoints.find((c) => c.location && (c.location.lat || c.location.lon));

    /* ── Оценка поездки и «Лучшее» ── */
    step = "rating";
    await page.locator(".tripRating .stars button").nth(4).click();
    await page.waitForTimeout(1200);
    all = await trips();
    ok(name, all.find((t) => t.id === tripId).meta?.rating === 5, "trip rated 5 stars");
    await page.goto(BASE + "/timeline/", { waitUntil: "load" });
    await page.waitForTimeout(1000);
    await page.locator(".tlFilters > .tagChip", { hasText: "Лучшее" }).click();
    await page.waitForTimeout(600);
    ok(name, (await page.locator(".tlTrip").count()) === 1, "Best filter keeps the 5-star trip");

    /* ── Настроение + фото в момент ── */
    step = "mood";
    await page.goto(BASE + `/moment/?trip=${tripId}&cp=${cafe.id}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    await page.locator('.momentBody .mediaPicker input[accept="image/*"]').setInputFiles([
      { name: "a.jpg", mimeType: "image/jpeg", buffer: await jpeg("#c0392b", "Кафе 1") },
      { name: "b.jpg", mimeType: "image/jpeg", buffer: await jpeg("#2980b9", "Кафе 2") },
    ]);
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /Редактировать/ }).click();
    await page.locator(".sheet .moodPicker button", { hasText: "😍" }).click();
    await page.locator('.sheet button[type="submit"]').click();
    await page.waitForTimeout(1200);
    all = await trips();
    ok(name, all.find((t) => t.id === tripId).checkpoints.find((c) => c.id === cafe.id).meta?.mood === "😍" && (await page.locator(".mMood").textContent()) === "😍", "mood saved and shown");

    /* ── Альбом из просмотра фото ── */
    step = "album";
    await page.locator(".momentBody .mediaGallery .mediaCell").first().click();
    await page.waitForTimeout(600);
    await page.locator(".lightbox").getByRole("button", { name: "В альбом" }).click();
    await page.locator(".albumPick .newAlbum").click();
    await page.waitForTimeout(1500);
    await page.locator(".lightboxClose").click();
    await page.goto(BASE + "/albums/", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const albumTxt = await page.locator(".albumCard").first().textContent().catch(() => "");
    ok(name, /Лучшее/.test(albumTxt) && /1 файл(?!ов|а)/.test(albumTxt), `album created from viewer: "${albumTxt}"`);
    await page.locator(".albumCard").first().click();
    await page.waitForURL(/\/album\//);
    await page.waitForTimeout(1200);
    ok(name, (await page.locator(".mediaCell").count()) === 1, "album page shows its photo");

    /* ── Тогда и сейчас: тот же парк, другой год ── */
    step = "then-now";
    all = await trips();
    const cafeNow = all.find((t) => t.id === tripId).checkpoints.find((c) => c.id === cafe.id);
    await idb(
      ([loc, cover]) =>
        new Promise((res) => {
          const r = indexedDB.open("my-history");
          r.onsuccess = () => {
            const st = r.result.transaction("kv", "readwrite").objectStore("kv");
            const g = st.get("trips");
            g.onsuccess = () => {
              const list = g.result;
              const now = new Date().toISOString();
              list.push({
                id: "11111111-2222-4333-8444-555555555555",
                title: "Прошлый раз",
                date: "2019-06-01",
                mediaIds: [],
                createdAt: now,
                updatedAt: now,
                meta: { kind: "event" },
                checkpoints: [{ id: "11111111-2222-4333-8444-666666666666", kind: "regular", title: "Тут же в 2019", location: loc, coverMediaId: cover, mediaIds: [cover], importance: 0, style: { shape: "circle", color: "#2f7bff", size: "m", showLabel: false, showPhoto: true } }],
              });
              st.put(list, "trips").onsuccess = () => res(true);
            };
          };
        }),
      [placed.location, cafeNow.mediaIds[1] ?? cafeNow.mediaIds[0]]
    );
    const target = placed;
    await page.goto(BASE + `/moment/?trip=${tripId}&cp=${target.id}`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const tn = await page.locator(".thenNow").textContent().catch(() => "");
    ok(name, /Тогда и сейчас/.test(tn) && /назад/.test(tn), `then & now: "${tn?.replace(/\s+/g, " ").slice(0, 80)}"`);
    await shot("1-then-now", true);

    /* ── Коллаж ── */
    step = "collage";
    await page.goto(BASE + `/trip/?id=${tripId}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    await page.locator(".taBtn", { hasText: "Коллаж" }).click();
    await page.waitForFunction(() => !document.querySelector(".collagePreview .recapLoading"), null, { timeout: 20000 });
    const painted = await page.evaluate(() => {
      const c = document.querySelector(".collagePreview canvas");
      const d = c.getContext("2d").getImageData(200, 200, 1, 1).data;
      return c.width === 1080 && d[0] + d[1] + d[2] > 60;
    });
    ok(name, painted, "collage drawn (1080 px)");
    await shot("2-collage");
    if (name === "desktop") {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: "Сохранить / отправить" }).click()]);
      ok(name, fs.statSync(await dl.path()).size > 20000, `collage saved: ${dl.suggestedFilename()}`);
    }
    await page.goto(BASE + `/trip/?id=${tripId}`, { waitUntil: "load" });
    await page.waitForTimeout(800);

    /* ── Сборы, расходы, документы ── */
    step = "plan";
    await page.locator(".taBtn", { hasText: "Сборы" }).click();
    await page.waitForURL(/\/plan\//);
    await page.locator(".tagChip", { hasText: "Море" }).click();
    await page.waitForTimeout(500);
    await page.locator(".packList input").first().check();
    await page.waitForTimeout(800);
    const prog = await page.locator(".packProgress span").textContent();
    ok(name, /Собрано 1 из 10/.test(prog), `packing: "${prog}"`);
    await page.getByRole("tab", { name: "Расходы" }).click();
    await page.waitForTimeout(500);
    await page.locator(".moneyForm input").nth(0).fill("Обед");
    await page.locator(".moneyForm input").nth(1).fill("1500");
    await page.locator(".moneyForm button").click();
    await page.locator(".moneyForm select").selectOption("road");
    await page.locator(".moneyForm input").nth(1).fill("3000");
    await page.locator(".moneyForm button").click();
    await page.waitForTimeout(800);
    const total = (await page.locator(".moneyTotal strong").textContent())?.replace(/\s/g, " ");
    ok(name, /4\s?500 ₽/.test(total), `expenses total: "${total}"`);
    await page.getByRole("tab", { name: "Документы" }).click();
    await page.waitForTimeout(500);
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    await page.locator('.docDrop input[type="file"]').setInputFiles({ name: "Билет.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.waitForSelector(".docList li", { timeout: 10000 });
    ok(name, /Билет\.pdf/.test(await page.locator(".docList").textContent()), "document attached");
    if (name === "desktop") {
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.locator(".docOpen").first().click()]);
      ok(name, fs.readFileSync(await dl.path(), "utf8").startsWith("%PDF"), `document opens: ${dl.suggestedFilename()}`);
    }
    await shot("3-plan");
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1200);
    all = await trips();
    const m = all.find((t) => t.id === tripId).meta;
    ok(name, m.packing?.length === 10 && m.expenses?.length === 2 && m.docs?.length === 1, "packing, expenses and docs persist");

    /* ── «Хочу поехать» ── */
    step = "wishes";
    await page.goto(BASE + "/wishes/", { waitUntil: "load" });
    await page.waitForTimeout(800);
    const pp = page.locator(".wishForm .placePicker input");
    await pp.type("Листвянка", { delay: 40 });
    await page.locator(".wishForm .suggestList button").first().waitFor({ timeout: 15000 });
    await page.locator(".wishForm .suggestList button").first().click();
    await page.locator('.wishForm input[placeholder^="Название"]').fill("Байкал зимой");
    await page.getByRole("button", { name: "+ Добавить мечту" }).click();
    await page.waitForTimeout(1500);
    ok(name, (await page.locator(".wishItem").count()) === 1, "wish added");
    await page.goto(BASE + "/map/", { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const stars = await page.locator(".lmIcon", { hasText: "⭐" }).count();
    ok(name, stars === 1, `wish shown on map: ${stars}`);
    /* ── Тепловая карта ── */
    step = "heat";
    await page.locator(".yearChips button", { hasText: "Тепловая" }).click();
    await page.waitForTimeout(1500);
    const heat = await page.locator(".leaflet-overlay-pane path").count();
    ok(name, heat >= 10, `heat map circles: ${heat}`);
    await shot("4-heat");
    await page.goto(BASE + "/wishes/", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Поехали!" }).click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 15000 });
    await page.waitForTimeout(1200);
    const newTripTitle = await page.locator(".heroTitle h1").textContent();
    await page.goto(BASE + "/wishes/", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    ok(name, newTripTitle === "Байкал зимой" && (await page.locator(".wishItem.done").count()) === 1, `wish → trip "${newTripTitle}", marked done`);

    /* ── Достижения ── */
    step = "achievements";
    await page.goto(BASE + "/achievements/", { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const sum = await page.locator(".achSummary").textContent();
    const got = Number(sum.match(/(\d+) из/)?.[1] ?? 0);
    const doneTitles = await page.locator(".achItem.done strong").allTextContents();
    ok(name, got >= 3 && ["Первый момент", "В путь!", "Мечта сбылась"].every((t) => doneTitles.includes(t)), `achievements: "${sum}" — ${doneTitles.join(", ")}`);
    await shot("5-achievements", true);

    /* ── Интересное рядом ── */
    step = "nearby";
    await page.goto(BASE + "/nearby/?lat=55.75393&lon=37.62084", { waitUntil: "load" });
    await page.waitForSelector(".nearItem", { timeout: 20000 });
    const n = await page.locator(".nearItem").count();
    ok(name, n >= 5, `nearby places from Wikipedia: ${n} (first: ${await page.locator(".nearItem strong").first().textContent()})`);
    await page.locator(".nearItem").first().getByRole("button", { name: "Хочу поехать" }).click();
    await page.waitForTimeout(1200);
    ok(name, (await page.locator(".nearItem").first().textContent()).includes("в планах"), "nearby place added to wishes");

    /* ── Фотокнига ── */
    step = "book";
    await page.goto(BASE + `/book/?trip=${tripId}`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    ok(name, (await page.locator(".bkCover").count()) === 1 && (await page.locator(".bkMoment").count()) >= 5, `photo book: ${await page.locator(".bkMoment").count()} moments`);
    if (name === "desktop") {
      const pdfBuf = await page.pdf({ format: "A4", printBackground: true });
      fs.writeFileSync(`${OUT}/feat3-book.pdf`, pdfBuf);
      ok(name, pdfBuf.length > 20000, `print → PDF ${Math.round(pdfBuf.length / 1024)} KB`);
    }

    /* ── Google Takeout ── */
    step = "takeout";
    const photo = await jpeg("#8e44ad", "Takeout");
    const meta = { title: "IMG_2001.JPG", photoTakenTime: { timestamp: String(Date.UTC(2023, 7, 12, 9, 30) / 1000) }, geoData: { latitude: 59.9398, longitude: 30.3146, altitude: 0 } };
    const zip = makeZip([
      { name: "Takeout/Google Фото/Лето 2023/IMG_2001.JPG", data: photo },
      { name: "Takeout/Google Фото/Лето 2023/IMG_2001.JPG.supplemental-metadata.json", data: Buffer.from(JSON.stringify(meta)), deflate: true },
    ]);
    await page.goto(BASE + "/import/", { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.locator('.takeoutBtns input[accept*="zip"]').setInputFiles({ name: "takeout-001.zip", mimeType: "application/zip", buffer: zip });
    await page.waitForSelector(".impCluster", { timeout: 20000 });
    await page.waitForTimeout(3000);
    const dayTitle = await page.locator(".impDay h2").first().textContent();
    const place = await page.locator(".impHead strong").first().textContent();
    ok(name, /12 августа 2023/.test(dayTitle) && /Петербург|Эрмитаж|Дворцов/.test(place + (await page.locator(".impPlace").first().textContent().catch(() => ""))), `takeout zip read: "${dayTitle}" · "${place}"`);
    await shot("6-takeout");
    await page.locator(".nmBottomSave").click();
    await page.waitForURL(/\/trip\/\?id=/, { timeout: 30000 });
    await page.waitForTimeout(1200);
    all = await trips();
    const imp = all.find((t) => t.date === "2023-08-12");
    ok(name, imp && imp.checkpoints[0].mediaIds.length === 1 && Math.abs(imp.checkpoints[0].location.lat - 59.9398) < 0.01, `takeout imported as event "${imp?.title}"`);
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

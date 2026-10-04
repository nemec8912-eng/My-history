// Проверка Supabase: связь, ключ, таблицы (RLS), настройки входа по email.
import fs from "node:fs";

const src = fs.readFileSync("lib/cloud.config.ts", "utf8");
const url = (process.env.SB_URL || src.match(/"(https:\/\/[^"]+supabase\.co[^"]*)"/)[1]).replace(/\/(rest|auth|storage)\/v1\/?$/, "").replace(/\/+$/, "");
const key = process.env.SB_KEY || src.match(/"(sb_publishable_[^"]+|eyJ[^"]+)"/)[1];
const out = [];
const h = { apikey: key };

async function check(name, path, opts = {}) {
  try {
    const res = await fetch(url + path, { headers: { ...h, ...(opts.headers || {}) } });
    const text = await res.text();
    out.push(`[cloud] ${name}: ${res.status} ${text.slice(0, 300).replace(/\s+/g, " ")}`);
    return { status: res.status, text };
  } catch (e) {
    out.push(`[cloud] ${name}: FAILED ${e.message}`);
    return { status: 0, text: "" };
  }
}

await check("health", "/auth/v1/health");
const s = await check("auth settings", "/auth/v1/settings");
try {
  const j = JSON.parse(s.text);
  out.push(`[cloud] email enabled=${j.external?.email} autoconfirm=${j.mailer_autoconfirm} disable_signup=${j.disable_signup}`);
} catch {}
for (const t of ["trips", "checkpoints", "media", "media_storage"]) await check(`table ${t}`, `/rest/v1/${t}?select=*&limit=1`);
await check("storage bucket media (anon)", "/storage/v1/object/list/media", {});
// Колонка meta (supabase/migrations/001_meta.sql): 200 — есть, 400 с упоминанием meta — нет.
for (const t of ["trips", "checkpoints"]) {
  const r = await check(`column ${t}.meta`, `/rest/v1/${t}?select=meta&limit=1`);
  out.push(`[cloud] META ${t}: ${r.status === 200 ? "OK" : "MISSING"}`);
}

// Google OAuth: зарегистрирован ли адрес возврата для входа на iPhone (без логина видно по ответу Google).
try {
  const gsrc = fs.readFileSync("lib/media/gdrive.ts", "utf8");
  const clientId = gsrc.match(/"([0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com)"/)[1];
  const redirect = "https://nemec8912-eng.github.io/My-history/gdrive/";
  const u = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: "token",
    scope: "https://www.googleapis.com/auth/drive.file", prompt: "consent",
  });
  const res = await fetch(u, { redirect: "manual", headers: { "Accept-Language": "en" } });
  const loc = res.headers.get("location") || "";
  const body = res.status === 200 ? await res.text() : "";
  const mismatch = /redirect_uri_mismatch/.test(loc + body);
  const badClient = /invalid_client|deleted_client|unauthorized_client/.test(loc + body);
  out.push(`[google] status=${res.status} redirect_registered=${!mismatch && !badClient} mismatch=${mismatch} badClient=${badClient} location=${loc.slice(0, 160)}`);
} catch (e) {
  out.push(`[google] FAILED ${e.message}`);
}

fs.mkdirSync(process.env.OUT_DIR || "screens", { recursive: true });
fs.appendFileSync(`${process.env.OUT_DIR || "screens"}/log.txt`, out.join("\n") + "\n");
console.log(out.join("\n"));

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

fs.mkdirSync(process.env.OUT_DIR || "screens", { recursive: true });
fs.appendFileSync(`${process.env.OUT_DIR || "screens"}/log.txt`, out.join("\n") + "\n");
console.log(out.join("\n"));

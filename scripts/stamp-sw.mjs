// После сборки: у каждой версии сайта свой кэш service worker — старые файлы удаляются при обновлении.
import fs from "node:fs";
const file = "out/sw.js";
if (fs.existsSync(file)) {
  const src = fs.readFileSync(file, "utf8");
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  fs.writeFileSync(file, src.replace(/const CACHE = "my-history-[^"]*";/, `const CACHE = "my-history-${stamp}";`));
  console.log("sw.js cache:", stamp);
}

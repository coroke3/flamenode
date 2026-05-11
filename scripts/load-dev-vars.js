/**
 * .dev.vars (wrangler 形式) を process.env に読み込む小さなローダー。
 * Node.js の `-r ./scripts/load-dev-vars.js` で起動時に読み込まれる。
 *
 * 既に値が定義されている環境変数は上書きしない (CI 等を尊重する)。
 */
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(process.cwd(), ".dev.vars");
if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
  console.log("[load-dev-vars] Loaded .dev.vars into process.env");
} else {
  console.warn("[load-dev-vars] .dev.vars not found. Copy from .dev.vars.example first.");
}

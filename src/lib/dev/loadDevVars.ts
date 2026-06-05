/**
 * ローカル開発時に .dev.vars を process.env へ読み込む。
 * `npm run dev` の -r preload だけでは Next の一部ワーカーに届かないことがあるため、
 * server-only モジュールからも冪等に呼ぶ。
 */
export function loadDevVarsIfNeeded(): void {
  if (process.env.NODE_ENV === "production") return;

  try {
    const req = eval("require") as NodeRequire;
    const fs = req("node:fs") as typeof import("node:fs");
    const path = req("node:path") as typeof import("node:path");
    const file = path.join(process.cwd(), ".dev.vars");
    if (!fs.existsSync(file)) return;

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
  } catch {
    /* preload 済みの場合は無視 */
  }
}

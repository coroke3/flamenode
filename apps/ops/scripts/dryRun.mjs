/**
 * MIG-0719: fixed, offline Ops-only Wrangler packaging dry-run.
 * No arbitrary deployment flags, no external account, no production route.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WRANGLER_CLI, offlineWranglerEnv } from "../../../scripts/new-worker-dry-run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CONFIG = "apps/ops/wrangler.toml";
const DIST_INDEX = "apps/ops/dist/index.html";
const ALLOWED_TOP = new Set(["name", "compatibility_date", "compatibility_flags", "workers_dev"]);
const ALLOWED_ASSETS = new Set(["directory", "not_found_handling", "run_worker_first"]);

export function assertOpsStaticConfig(config) {
  if (typeof config !== "string") throw new Error("Ops config missing");
  let section = "";
  const seen = new Set();
  for (const source of config.split(/\r?\n/)) {
    const line = source.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (line !== "[assets]" || section) throw new Error("Ops config may have only one assets table");
      section = "assets";
      continue;
    }
    const m = /^([a-z_]+)\s*=\s*(.+)$/.exec(line);
    if (!m) throw new Error("Unsupported Ops Wrangler syntax");
    const key = section + "." + m[1];
    if (seen.has(key)) throw new Error("Duplicate Ops Wrangler key: " + key);
    seen.add(key);
    if (!(section ? ALLOWED_ASSETS : ALLOWED_TOP).has(m[1])) {
      throw new Error("Unapproved Ops Wrangler key: " + key);
    }
    const expected = {
      ".name": '"flamenode-ops"',
      ".workers_dev": "false",
      "assets.directory": '"./dist"',
      "assets.not_found_handling": '"single-page-application"',
      "assets.run_worker_first": "false",
    };
    if (Object.hasOwn(expected, key) && m[2] !== expected[key]) {
      throw new Error("Unsafe Ops config value: " + key);
    }
  }
  for (const required of [".name", ".workers_dev", "assets.directory", "assets.not_found_handling", "assets.run_worker_first"]) {
    if (!seen.has(required)) throw new Error("Missing mandatory Ops config key: " + required);
  }
  return true;
}

export function opsDryRunArgs(outdir) {
  if (!path.isAbsolute(outdir)) throw new Error("Absolute output directory required");
  return [WRANGLER_CLI, "deploy", "--dry-run", "--outdir", outdir, "--config", CONFIG];
}

function main(args) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--plan")) {
    throw new Error("Only --plan supported; arbitrary flags forbidden");
  }
  assertOpsStaticConfig(readFileSync(path.join(ROOT, CONFIG), "utf8"));
  if (args[0] === "--plan") {
    process.stdout.write(JSON.stringify({ config: CONFIG, built: DIST_INDEX, args: opsDryRunArgs(path.join(os.tmpdir(), "flamenode-ops-dry-run")) }, null, 2) + "\n");
    return;
  }
  const built = lstatSync(path.join(ROOT, DIST_INDEX));
  if (!built.isFile() || built.isSymbolicLink() || built.size === 0) throw new Error("Ops SPA static build missing");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "flamenode-ops-dry-run-"));
  try {
    const result = spawnSync(process.execPath, opsDryRunArgs(path.join(tmp, "wrangler-out")), {
      cwd: ROOT, shell: false, stdio: "inherit", timeout: 240_000,
      env: offlineWranglerEnv(process.env, tmp),
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Ops offline Wrangler dry-run failed: " + result.status);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

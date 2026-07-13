#!/usr/bin/env node
/** Validate checked-in Pages and unified Cron Worker templates. Placeholder IDs are allowed here. */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const errors = [];
const expectedWorkers = new Map([
  ["background-jobs", {
    name: "flamenode-background-jobs",
    d1: true,
    r2: true,
    kv: true,
  }],
]);

function read(relative) {
  const full = path.join(ROOT, relative);
  if (!fs.existsSync(full)) {
    errors.push(`${relative} is missing`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

function requirePattern(text, relative, pattern, description) {
  if (!pattern.test(text)) errors.push(`${relative}: ${description}`);
}

function checkWorker(directory, expected) {
  const relative = path.join("workers", directory, "wrangler.toml");
  const text = read(relative);
  requirePattern(text, relative, new RegExp(`^name\\s*=\\s*"${expected.name}"\\s*$`, "m"), "wrong worker name");
  requirePattern(text, relative, /^main\s*=\s*"index\.ts"\s*$/m, "main must be index.ts");
  requirePattern(text, relative, /^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"\s*$/m, "compatibility_date is required");
  requirePattern(text, relative, /compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/m, "nodejs_compat is required");
  requirePattern(text, relative, /\[triggers\][\s\S]*?crons\s*=\s*\[[\s\S]*?"\*\/5 \* \* \* \*"[\s\S]*?"0 \* \* \* \*"[\s\S]*?\]/m, "5-minute and hourly cron triggers are required");
  if (expected.d1) requirePattern(text, relative, /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"/m, "D1 binding DB is required");
  if (expected.r2) requirePattern(text, relative, /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"R2"/m, "R2 binding R2 is required");
  if (expected.kv) requirePattern(text, relative, /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"KV"/m, "KV binding KV is required");
  if (/\b(?:token|secret)\s*=/i.test(text)) errors.push(`${relative}: secrets must not be committed`);
}

const rootToml = read("wrangler.toml");
requirePattern(rootToml, "wrangler.toml", /^name\s*=\s*"flamenode"\s*$/m, "Pages project name is required");
requirePattern(rootToml, "wrangler.toml", /^pages_build_output_dir\s*=\s*"\.vercel\/output\/static"\s*$/m, "Pages output must be .vercel/output/static");
requirePattern(rootToml, "wrangler.toml", /^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"\s*$/m, "compatibility_date is required");
requirePattern(rootToml, "wrangler.toml", /compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/m, "nodejs_compat is required");
requirePattern(rootToml, "wrangler.toml", /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"DB"/m, "D1 binding DB is required");
requirePattern(rootToml, "wrangler.toml", /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"BUCKET"/m, "R2 binding BUCKET is required");
requirePattern(rootToml, "wrangler.toml", /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"KV"/m, "KV binding KV is required");
if (/opennext|workers\s+sites/i.test(rootToml)) errors.push("wrangler.toml must remain a Pages + next-on-pages template");

const workerDirectories = fs
  .readdirSync(path.join(ROOT, "workers"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, "workers", entry.name, "wrangler.toml")))
  .map((entry) => entry.name)
  .sort();
const expectedDirectories = [...expectedWorkers.keys()].sort();
if (workerDirectories.join(",") !== expectedDirectories.join(",")) {
  errors.push(`exactly one deployed worker template is required: ${expectedDirectories.join(", ")}`);
}
for (const [directory, expected] of expectedWorkers) checkWorker(directory, expected);

if (errors.length) {
  console.error("[check:cloudflare-template] FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("[check:cloudflare-template] OK (one Worker, two Cron triggers)");

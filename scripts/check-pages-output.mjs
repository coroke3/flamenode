#!/usr/bin/env node
/** Validate the deployable @cloudflare/next-on-pages artifact without secrets. */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = path.resolve(process.env.PAGES_OUTPUT_DIR?.trim() || path.join(ROOT, ".vercel", "output", "static"));
const errors = [];

function file(relative) {
  return path.join(OUTPUT, relative);
}

function hasFile(relative) {
  try {
    return fs.statSync(file(relative)).isFile();
  } catch {
    return false;
  }
}

function hasWorkerEntry() {
  const worker = file("_worker.js");
  try {
    const stat = fs.statSync(worker);
    if (stat.isFile()) return stat.size > 0;
    return stat.isDirectory() && fs.statSync(path.join(worker, "index.js")).size > 0;
  } catch {
    return false;
  }
}

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}

function assertNoSecrets(files) {
  const suspicious = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/i,
    /(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CF_IDS_JSON|WORKER_ADMIN_TOKEN|AUTH_SECRET|SPREADSHEET_IMPORT_PREVIEW_SECRET|DISCORD_BOT_TOKEN|DISCORD_WEBHOOK_URL|YOUTUBE_API_KEY)\s*[:=]\s*["'][^"']{8,}/,
  ];
  for (const full of files) {
    const extension = path.extname(full).toLowerCase();
    if (![".js", ".json", ".html", ".txt"].includes(extension)) continue;
    if (fs.statSync(full).size > 512 * 1024) continue;
    const text = fs.readFileSync(full, "utf8");
    if (suspicious.some((pattern) => pattern.test(text))) {
      errors.push(`${path.relative(ROOT, full)} contains a secret-looking value`);
    }
  }
}

function assertNoCloudflareIdFiles(files) {
  for (const full of files) {
    const relative = path.relative(OUTPUT, full);
    const normalized = relative.replaceAll("\\", "/");
    const basename = path.basename(full);
    const looksLikeIdsFile = /^(?:ids|cloudflare[-_]ids)\.json$/i.test(basename);
    let looksLikeCloudflareIds = false;
    if (!looksLikeIdsFile && path.extname(full).toLowerCase() === ".json" && fs.statSync(full).size <= 512 * 1024) {
      const text = fs.readFileSync(full, "utf8");
      looksLikeCloudflareIds = /"(?:d1_database_id|kv_namespace_id|kv_preview_id)"\s*:/.test(text);
    }
    if (looksLikeIdsFile || looksLikeCloudflareIds) {
      errors.push(`${normalized} contains Cloudflare resource IDs; remove this file from the Pages artifact before deploy`);
    }
  }
}

if (!fs.existsSync(OUTPUT)) {
  errors.push(".vercel/output/static is missing; run npm run pages:build first");
} else {
  if (!hasWorkerEntry()) {
    errors.push("Pages Worker entry _worker.js is missing or empty");
  }
  if (!fs.existsSync(file("_next/static"))) {
    errors.push("_next/static is missing");
  }
  if (!hasFile("_routes.json")) {
    errors.push("_routes.json is missing");
  } else {
    try {
      const routes = JSON.parse(fs.readFileSync(file("_routes.json"), "utf8"));
      if (routes.version !== 1) errors.push("_routes.json version must be 1");
      if (!Array.isArray(routes.include) || !routes.include.includes("/*")) {
        errors.push("_routes.json must include /*");
      }
      if (!Array.isArray(routes.exclude) || !routes.exclude.includes("/_next/static/*")) {
        errors.push("_routes.json must exclude /_next/static/*");
      }
    } catch (error) {
      errors.push(`_routes.json is invalid JSON: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  const files = collectFiles(OUTPUT);
  if (files.some((full) => /(?:^|[\\/])\.dev\.vars$/i.test(full))) {
    const devVars = files.find((full) => /(?:^|[\\/])\.dev\.vars$/i.test(full));
    errors.push(`${path.relative(OUTPUT, devVars).replaceAll("\\", "/")} contains .dev.vars; remove this file from the Pages artifact before deploy`);
  }
  assertNoCloudflareIdFiles(files);
  assertNoSecrets(files);
}

if (errors.length) {
  console.error("[check:pages-output] FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("[check:pages-output] OK");

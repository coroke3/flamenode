#!/usr/bin/env node
/** Validate production Cloudflare IDs and credentials, or explicitly validate a CI fixture. */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MODE = process.env.CLOUDFLARE_CONFIG_MODE?.trim() || "production";
const WRANGLER_FILES = [
  "wrangler.toml",
  "workers/fast-jobs/wrangler.toml",
  "workers/content-jobs/wrangler.toml",
  "workers/sync-jobs/wrangler.toml",
];
const D1_ZERO = "00000000-0000-0000-0000-000000000000";
const KV_ZERO = "00000000000000000000000000000000";

function isZero(value, kind) {
  if (!value) return true;
  return value.replace(/-/g, "") === (kind === "d1" ? D1_ZERO.replace(/-/g, "") : KV_ZERO);
}

function checkToml(filePath, relativePath, allowPlaceholders) {
  if (!fs.existsSync(filePath)) return [];
  const errors = [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const lineNumber = index + 1;
    const d1 = line.match(/database_id\s*=\s*"([^"]*)"/);
    if (d1 && !allowPlaceholders && isZero(d1[1], "d1")) {
      errors.push(`${relativePath}:${lineNumber}: D1 database_id is a placeholder`);
    }
    const kv = line.match(/^id\s*=\s*"([^"]*)"/);
    if (kv && !d1 && !allowPlaceholders && isZero(kv[1], "kv")) {
      errors.push(`${relativePath}:${lineNumber}: KV id is a placeholder`);
    }
    const preview = line.match(/preview_id\s*=\s*"([^"]*)"/);
    if (preview && !allowPlaceholders && isZero(preview[1], "kv")) {
      errors.push(`${relativePath}:${lineNumber}: KV preview_id is a placeholder`);
    }
  }
  return errors;
}

function main() {
  if (!new Set(["production", "fixture"]).has(MODE)) {
    console.error(`[check:cloudflare-config] invalid CLOUDFLARE_CONFIG_MODE: ${MODE}`);
    process.exit(1);
  }

  const errors = [];
  if (MODE === "production") {
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CF_IDS_JSON"]) {
      if (!process.env[name]?.trim()) errors.push(`production secret ${name} is required`);
    }
    if (process.env.CF_IDS_JSON?.trim()) {
      try {
        const ids = JSON.parse(process.env.CF_IDS_JSON);
        for (const name of ["d1_database_id", "kv_namespace_id", "kv_preview_id"]) {
          if (!ids[name]?.trim() || isZero(ids[name], name.startsWith("d1") ? "d1" : "kv")) {
            errors.push(`CF_IDS_JSON.${name} must be a real Cloudflare ID`);
          }
        }
      } catch (error) {
        errors.push(`CF_IDS_JSON must be valid JSON: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }

  for (const relativePath of WRANGLER_FILES) {
    errors.push(...checkToml(path.join(ROOT, relativePath), relativePath, MODE === "fixture"));
  }

  if (errors.length) {
    console.error(`[check:cloudflare-config] FAILED (${MODE})`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[check:cloudflare-config] OK (${MODE}; production validation is ${MODE === "production" ? "enabled" : "not performed"})`);
}

main();

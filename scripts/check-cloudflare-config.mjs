#!/usr/bin/env node
/** Validate production Cloudflare IDs and credentials, or explicitly validate a CI fixture. */
import fs from "node:fs";
import path from "node:path";

const MODE = process.env.CLOUDFLARE_CONFIG_MODE?.trim() || "production";
const ROOT = path.resolve(
  MODE === "fixture" ? process.env.CLOUDFLARE_CONFIG_ROOT?.trim() || process.cwd() : process.cwd(),
);
const WRANGLER_FILES = [
  "wrangler.toml",
  "workers/fast-jobs/wrangler.toml",
  "workers/content-jobs/wrangler.toml",
  "workers/sync-jobs/wrangler.toml",
];
const D1_ZERO = "00000000-0000-0000-0000-000000000000";
const KV_ZERO = "00000000000000000000000000000000";
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_PATTERN = /^[0-9a-f]{32}$/i;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

function isNonZeroUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) && value.toLowerCase() !== D1_ZERO;
}

function isNonZeroHexId(value) {
  return typeof value === "string" && HEX_ID_PATTERN.test(value) && value.toLowerCase() !== KV_ZERO;
}

function isSafeName(value) {
  return typeof value === "string" && SAFE_NAME_PATTERN.test(value);
}

function checkToml(filePath, relativePath, allowPlaceholders) {
  if (!fs.existsSync(filePath)) return [`${relativePath}: required Cloudflare configuration file is missing`];
  const errors = [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const lineNumber = index + 1;
    const d1 = line.match(/database_id\s*=\s*"([^"]*)"/);
    if (d1 && !allowPlaceholders && !isNonZeroUuid(d1[1])) {
      errors.push(`${relativePath}:${lineNumber}: D1 database_id must be a non-zero UUID`);
    }
    const kv = line.match(/^id\s*=\s*"([^"]*)"/);
    if (kv && !d1 && !allowPlaceholders && !isNonZeroHexId(kv[1])) {
      errors.push(`${relativePath}:${lineNumber}: KV id must be a non-zero 32-character hex ID`);
    }
    const preview = line.match(/preview_id\s*=\s*"([^"]*)"/);
    if (preview && !allowPlaceholders && !isNonZeroHexId(preview[1])) {
      errors.push(`${relativePath}:${lineNumber}: KV preview_id must be a non-zero 32-character hex ID`);
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
    if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) errors.push("CLOUDFLARE_API_TOKEN is required");
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!ACCOUNT_ID_PATTERN.test(accountId ?? "")) errors.push("CLOUDFLARE_ACCOUNT_ID must be a 32-character hex ID");
    const idsJson = process.env.CF_IDS_JSON?.trim();
    if (!idsJson) {
      errors.push("CF_IDS_JSON is required");
    } else {
      try {
        const ids = JSON.parse(idsJson);
        if (ids === null || typeof ids !== "object" || Array.isArray(ids) || Object.getPrototypeOf(ids) !== Object.prototype) {
          errors.push("CF_IDS_JSON must be a plain object");
        } else {
          if (!isNonZeroUuid(ids.d1_database_id)) errors.push("CF_IDS_JSON.d1_database_id must be a non-zero UUID");
          if (!isNonZeroHexId(ids.kv_namespace_id)) errors.push("CF_IDS_JSON.kv_namespace_id must be a non-zero 32-character hex ID");
          if (!isNonZeroHexId(ids.kv_preview_id)) errors.push("CF_IDS_JSON.kv_preview_id must be a non-zero 32-character hex ID");
          for (const name of ["d1_database_name", "r2_bucket_name", "pages_project_name"]) {
            if (!isSafeName(ids[name])) errors.push(`CF_IDS_JSON.${name} must be a safe non-empty string`);
          }
        }
      } catch {
        errors.push("CF_IDS_JSON must be valid JSON");
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

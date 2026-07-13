#!/usr/bin/env node
/**
 * cloudflare/ids.json の ID を各 wrangler.toml へ反映する。
 * 初回セットアップ: cp cloudflare/ids.example.json cloudflare/ids.json → ID を埋める → npm run cf:sync-ids
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IDS_PATH = path.join(ROOT, "cloudflare", "ids.json");

const WRANGLER_FILES = [
  "wrangler.toml",
  "workers/fast-jobs/wrangler.toml",
  "workers/content-jobs/wrangler.toml",
  "workers/sync-jobs/wrangler.toml",
];

const ID_KEYS = [
  "d1_database_id",
  "d1_database_name",
  "kv_namespace_id",
  "kv_preview_id",
  "r2_bucket_name",
];

function parseIds(label, raw) {
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("JSON objectではありません");
    }
    return parsed;
  } catch (error) {
    console.error(
      `[cf:sync-ids] ${label}のJSONが不正です: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
    process.exit(1);
  }
}

function normalizedIdValue(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function assertIdsDoNotConflict(envIds, fileIds) {
  const conflicts = ID_KEYS.filter((key) => {
    const envValue = normalizedIdValue(envIds[key]);
    const fileValue = normalizedIdValue(fileIds[key]);

    return (
      envValue &&
      fileValue &&
      envValue !== fileValue
    );
  });

  if (conflicts.length === 0) return;

  console.error(
    [
      "[cf:sync-ids] CF_IDS_JSONとcloudflare/ids.jsonが一致しません。",
      ...conflicts.map(
        (key) =>
          `  - ${key}: environment=${JSON.stringify(
            envIds[key],
          )}, file=${JSON.stringify(fileIds[key])}`,
      ),
      "誤ったCloudflareリソースへのデプロイを防ぐため停止しました。",
    ].join("\n"),
  );
  process.exit(1);
}

function loadIds() {
  const envRaw =
    process.env.CF_IDS_JSON?.trim() ?? "";
  const fileExists = fs.existsSync(IDS_PATH);

  const envIds = envRaw
    ? parseIds("CF_IDS_JSON", envRaw)
    : null;
  const fileIds = fileExists
    ? parseIds(
        "cloudflare/ids.json",
        fs.readFileSync(IDS_PATH, "utf8"),
      )
    : null;

  if (envIds && fileIds) {
    assertIdsDoNotConflict(envIds, fileIds);
    return envIds;
  }

  if (envIds) return envIds;
  if (fileIds) return fileIds;

  console.error(
    "[cf:sync-ids] Cloudflare ID設定がありません。\n" +
      "  ローカル: cloudflare/ids.json\n" +
      "  CI: CF_IDS_JSON\n" +
      "  のどちらかを設定してください。",
  );
  process.exit(1);
}

function patchToml(content, ids) {
  let out = content;

  if (ids.d1_database_id) {
    out = out.replace(
      /database_id\s*=\s*"[^"]*"/g,
      `database_id = "${ids.d1_database_id}"`,
    );
  }

  if (ids.kv_namespace_id) {
    out = out.replace(
      /^id\s*=\s*"[^"]*"/gm,
      `id = "${ids.kv_namespace_id}"`,
    );
  }

  if (ids.kv_preview_id) {
    if (/preview_id\s*=/.test(out)) {
      out = out.replace(
        /preview_id\s*=\s*"[^"]*"/g,
        `preview_id = "${ids.kv_preview_id}"`,
      );
    } else {
      out = out.replace(
        /^(id\s*=\s*"[^"]*")/m,
        `$1\npreview_id = "${ids.kv_preview_id}"`,
      );
    }
  }

  if (ids.r2_bucket_name) {
    out = out.replace(
      /bucket_name\s*=\s*"[^"]*"/g,
      `bucket_name = "${ids.r2_bucket_name}"`,
    );
  }

  if (ids.d1_database_name) {
    out = out.replace(
      /database_name\s*=\s*"[^"]*"/g,
      `database_name = "${ids.d1_database_name}"`,
    );
  }

  return out;
}

function main() {
  const ids = loadIds();
  const placeholders = [
    ids.d1_database_id,
    ids.kv_namespace_id,
  ].filter((v) => !v || /^0+$/.test(v.replace(/-/g, "")));

  if (placeholders.length > 0) {
    console.warn(
      "[cf:sync-ids] 警告: プレースホルダ ID のままです。本番デプロイ前に実 ID を設定してください。",
    );
  }

  for (const rel of WRANGLER_FILES) {
    const filePath = path.join(ROOT, rel);
    if (!fs.existsSync(filePath)) {
      console.warn(`[cf:sync-ids] skip (not found): ${rel}`);
      continue;
    }
    const before = fs.readFileSync(filePath, "utf8");
    const after = patchToml(before, ids);
    if (before !== after) {
      fs.writeFileSync(filePath, after);
      console.log(`[cf:sync-ids] updated: ${rel}`);
    } else {
      console.log(`[cf:sync-ids] unchanged: ${rel}`);
    }
  }

  console.log("[cf:sync-ids] done.");
}

main();

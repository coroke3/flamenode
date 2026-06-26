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
  "workers/json-generator/wrangler.toml",
  "workers/cleanup/wrangler.toml",
  "workers/youtube-sync/wrangler.toml",
  "workers/score-recalc/wrangler.toml",
  "workers/notification-dispatcher/wrangler.toml",
];

function loadIds() {
  if (process.env.CF_IDS_JSON?.trim()) {
    return JSON.parse(process.env.CF_IDS_JSON);
  }
  if (fs.existsSync(IDS_PATH)) {
    return JSON.parse(fs.readFileSync(IDS_PATH, "utf8"));
  }
  console.error(
    "[cf:sync-ids] cloudflare/ids.json が見つかりません。\n" +
      "  cp cloudflare/ids.example.json cloudflare/ids.json\n" +
      "  を実行し、wrangler で作成した ID を埋めてから再実行してください。\n" +
      "  CI では環境変数 CF_IDS_JSON に JSON 文字列を渡せます。",
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

#!/usr/bin/env node
/**
 * wrangler.toml にプレースホルダ ID が残っていないか検査する。
 * CI のデプロイ前に実行し、ID 未設定事故を防ぐ。
 *
 * 検査対象:
 *   - database_id が "00000000-0000-0000-0000-000000000000" ならエラー
 *   - KV id / preview_id が "00000000000000000000000000000000" ならエラー
 *   - ids.json / CF_IDS_JSON が無い場合もエラー (CI では必須)
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

const D1_ZERO = "00000000-0000-0000-0000-000000000000";
const KV_ZERO = "00000000000000000000000000000000";

function isZeroUuid(value) {
  if (!value) return false;
  return value.replace(/-/g, "").replace(/0/g, "").length === 0;
}

function isZeroId(value) {
  if (!value) return false;
  return value.replace(/0/g, "").length === 0;
}

function checkToml(filePath, relPath) {
  const errors = [];

  if (!fs.existsSync(filePath)) {
    return errors;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    const d1Match = line.match(/database_id\s*=\s*"([^"]*)"/);
    if (d1Match && isZeroUuid(d1Match[1])) {
      errors.push(`${relPath}:${lineNum}: D1 database_id がプレースホルダのままです (${d1Match[1]})`);
    }

    const kvIdMatch = line.match(/^id\s*=\s*"([^"]*)"/);
    if (kvIdMatch && isZeroId(kvIdMatch[1]) && !d1Match) {
      errors.push(`${relPath}:${lineNum}: KV id がプレースホルダのままです (${kvIdMatch[1]})`);
    }

    const kvPreviewMatch = line.match(/preview_id\s*=\s*"([^"]*)"/);
    if (kvPreviewMatch && isZeroId(kvPreviewMatch[1])) {
      errors.push(`${relPath}:${lineNum}: KV preview_id がプレースホルダのままです (${kvPreviewMatch[1]})`);
    }
  }

  return errors;
}

function main() {
  const errors = [];

  const hasCfIdsJson = !!process.env.CF_IDS_JSON?.trim();
  const hasLocalIds = fs.existsSync(IDS_PATH);

  if (!hasCfIdsJson && !hasLocalIds) {
    errors.push(
      "Cloudflare ID 設定ファイルが見つかりません。\n" +
        "  GitHub Secret `CF_IDS_JSON` を設定するか、\n" +
        "  ローカルでは `cp cloudflare/ids.example.json cloudflare/ids.json` して `npm run cf:sync-ids` を実行してください。",
    );
  }

  for (const rel of WRANGLER_FILES) {
    const filePath = path.join(ROOT, rel);
    errors.push(...checkToml(filePath, rel));
  }

  if (errors.length > 0) {
    console.error("[check:cloudflare-config] エラー:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    console.error(
      "\n  本番デプロイ前に、すべてのプレースホルダ ID を実 ID に置き換えてください。\n" +
        "  npm run cf:sync-ids を実行して ID を同期してください。",
    );
    process.exit(1);
  }

  console.log("[check:cloudflare-config] OK: すべての wrangler.toml の ID が正しく設定されています。");
}

main();

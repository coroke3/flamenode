#!/usr/bin/env node
/**
 * Cloudflare 上に FlameNode 用リソース (D1 / R2 / KV) を作成し、
 * cloudflare/ids.json を生成して wrangler.toml 群へ同期する。
 *
 * 前提: wrangler login 済み
 * 使い方: npm run cf:bootstrap
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IDS_PATH = path.join(ROOT, "cloudflare", "ids.json");
const EXAMPLE_PATH = path.join(ROOT, "cloudflare", "ids.example.json");

const D1_NAME = "flamenode_db";
const R2_NAME = "flamenode-storage";
const KV_NAME = "FLAMENODE_KV";
const PAGES_PROJECT = "flamenode";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
}

function parseD1Id(output) {
  const m = output.match(/database_id\s*=\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

function parseKvId(output) {
  const m = output.match(/id\s*=\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

function ensureWranglerLogin() {
  try {
    run("npx wrangler whoami");
  } catch {
    console.error(
      "[cf:bootstrap] wrangler にログインしていません。先に `npx wrangler login` を実行してください。",
    );
    process.exit(1);
  }
}

function loadExistingIds() {
  if (fs.existsSync(IDS_PATH)) {
    return JSON.parse(fs.readFileSync(IDS_PATH, "utf8"));
  }
  if (fs.existsSync(EXAMPLE_PATH)) {
    return JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8"));
  }
  return {};
}

function isPlaceholder(id) {
  return !id || /^0+$/.test(String(id).replace(/-/g, ""));
}

function main() {
  ensureWranglerLogin();

  const ids = loadExistingIds();
  ids.d1_database_name = D1_NAME;
  ids.r2_bucket_name = R2_NAME;
  ids.pages_project_name = PAGES_PROJECT;

  if (isPlaceholder(ids.d1_database_id)) {
    console.log("[cf:bootstrap] D1 を作成します…");
    const out = run(`npx wrangler d1 create ${D1_NAME}`);
    const created = parseD1Id(out);
    if (created) ids.d1_database_id = created;
  } else {
    console.log(`[cf:bootstrap] D1 は既存 ID を使用: ${ids.d1_database_id}`);
  }

  console.log("[cf:bootstrap] R2 バケットを作成します (既存ならスキップ)…");
  try {
    run(`npx wrangler r2 bucket create ${R2_NAME}`);
  } catch {
    console.log("[cf:bootstrap] R2 バケットは既に存在する可能性があります。");
  }

  if (isPlaceholder(ids.kv_namespace_id)) {
    console.log("[cf:bootstrap] KV (本番) を作成します…");
    const out = run(`npx wrangler kv namespace create ${KV_NAME}`);
    const created = parseKvId(out);
    if (created) ids.kv_namespace_id = created;
  } else {
    console.log(`[cf:bootstrap] KV 本番は既存 ID を使用: ${ids.kv_namespace_id}`);
  }

  if (isPlaceholder(ids.kv_preview_id)) {
    console.log("[cf:bootstrap] KV (プレビュー) を作成します…");
    const out = run(`npx wrangler kv namespace create ${KV_NAME} --preview`);
    const created = parseKvId(out);
    if (created) ids.kv_preview_id = created;
  } else {
    console.log(`[cf:bootstrap] KV プレビューは既存 ID を使用: ${ids.kv_preview_id}`);
  }

  fs.mkdirSync(path.dirname(IDS_PATH), { recursive: true });
  fs.writeFileSync(IDS_PATH, JSON.stringify(ids, null, 2) + "\n");
  console.log(`[cf:bootstrap] wrote ${IDS_PATH}`);

  run("node scripts/sync-wrangler-ids.mjs");

  console.log(`
[cf:bootstrap] 完了。次のステップ:
  1. wrangler d1 migrations apply ${D1_NAME} --remote
  2. .dev.vars を用意 (cp .dev.vars.example .dev.vars)
  3. wrangler pages secret put … で Auth 系シークレットを登録
  4. npm run pages:deploy
  5. Dashboard → Pages → ${PAGES_PROJECT} → Functions で D1/R2/KV をバインド
  6. npm run workers:deploy

詳細は DEPLOY.md を参照してください。
`);
}

main();

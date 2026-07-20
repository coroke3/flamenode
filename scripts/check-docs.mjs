#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const errors = [];

const requiredActive = [
  "README.md",
  "AGENTS.md",
  "LOCAL.md",
  "DEPLOY.md",
  "docs/README.md",
  "docs/operations/README.md",
  "docs/database/README.md",
  "docs/database/change-log.md",
];
const requiredPaths = [
  "docs/operations/migrations.md",
  "docs/operations/workers.md",
  "docs/operations/audit-and-restore.md",
  "docs/operations/static-delivery.md",
  "docs/operations/incident-response.md",
  "docs/operations/ui-acceptance.md",
];
const localLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const npmScriptPattern = /`npm run ([a-zA-Z0-9:_-]+)(?:\s+[^`]*)?`/g;

const forbiddenActiveClaims = [
  [
    /バックグラウンドで起動済み|自動セットアップ済み|npm install 完了/gi,
    "個人PC固有の実施状態",
  ],
  [/Node\.js\s*20|Node\s*20|v20以上/gi, "旧Node.js 20要件"],
  [/0021_slim_mvp_drop_unused_tables/gi, "旧migration固定参照"],
  [
    /(?:OpenNext|open-next).{0,40}(?:を採用する|が正式構成|へ移行する)/gi,
    "OpenNextを現行構成とする記述",
  ],
  [
    /(?:permission_mask).{0,40}(?:が権限正本|を使用する|で判定する)/gi,
    "旧permission_maskを現行正本とする記述",
  ],
  [
    /(?:runtime[ -]migration|実行時migration).{0,40}(?:を実行する|で適用する|が正本)/gi,
    "runtime migrationを現行手順とする記述",
  ],
  [
    /(?:legacy import|旧形式インポート).{0,40}(?:を有効化|を使用する|から投入する|を実行する)/gi,
    "廃止済み旧形式インポートを現行機能とする記述",
  ],
];

function file(relative) {
  return path.join(root, relative);
}
function read(relative) {
  return fs.readFileSync(file(relative), "utf8");
}
function isHistorical(relative, text) {
  return (
    relative
      .split(path.sep)
      .some((part) => ["historical", "archive"].includes(part.toLowerCase())) ||
    /Status:\s*Historical/i.test(text)
  );
}
function checkLinks(relative, text) {
  for (const match of text.matchAll(localLinkPattern)) {
    const target = match[1].trim().split(/[?#]/, 1)[0];
    if (
      !target ||
      /^(?:https?|mailto):/i.test(target) ||
      target.startsWith("#") ||
      target.startsWith("`") ||
      target.includes("<")
    ) {
      continue;
    }
    if (!fs.existsSync(path.resolve(path.dirname(file(relative)), target))) {
      errors.push(`${relative}: link先がありません: ${target}`);
    }
  }
}
function checkNpmScripts(relative, text) {
  for (const match of text.matchAll(npmScriptPattern)) {
    const script = match[1];
    if (!packageScripts.has(script)) {
      errors.push(`${relative}: 存在しないnpm scriptを参照しています: ${script}`);
    }
  }
}
function checkActiveMetadata(relative, text) {
  if (!/Status:\s*Active/i.test(text)) {
    errors.push(`${relative}: Status: Active がありません。`);
  }
  if (!/Last verified:\s*\d{4}-\d{2}-\d{2}/i.test(text)) {
    errors.push(`${relative}: Last verified metadata がありません。`);
  }
  if (!/Verified against commit:\s*`[0-9a-f]{7,40}`/i.test(text)) {
    errors.push(`${relative}: Verified against commit metadata がありません。`);
  }
  if (!/Source of truth:\s*`[^`]+`/i.test(text)) {
    errors.push(`${relative}: Source of truth metadata がありません。`);
  }
  if (/\+\s*working tree|current working tree/i.test(text)) {
    errors.push(`${relative}: 未コミット状態を検証根拠に含めないでください。`);
  }
}
function collectMarkdown(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, result);
    else if (entry.isFile() && entry.name.endsWith(".md")) result.push(full);
  }
  return result;
}

for (const relative of requiredActive) {
  if (!fs.existsSync(file(relative))) {
    errors.push(`${relative} がありません。`);
    continue;
  }
  const text = read(relative);
  checkActiveMetadata(relative, text);
  checkLinks(relative, text);
  checkNpmScripts(relative, text);
}
for (const relative of requiredPaths) {
  if (!fs.existsSync(file(relative))) errors.push(`${relative} がありません。`);
}

for (const full of collectMarkdown(file("docs"))) {
  const relative = path.relative(root, full);
  const text = fs.readFileSync(full, "utf8");
  if (isHistorical(relative, text) || !/Status:\s*Active/i.test(text)) continue;
  if (/\+\s*working tree|current working tree/i.test(text)) {
    errors.push(
      `${relative}: Active文書へworking treeを検証根拠として記載できません。`,
    );
  }
  for (const [pattern, label] of forbiddenActiveClaims) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      errors.push(`${relative}: Active文書に旧現行仕様 ${label} が残っています。`);
    }
  }
  checkLinks(relative, text);
  checkNpmScripts(relative, text);
}

const wrangler = read("wrangler.toml");
if (!packageJson.devDependencies?.["@cloudflare/next-on-pages"]) {
  errors.push("package.json: Pages adapter がありません。");
}
if (
  !/^pages_build_output_dir\s*=\s*"\.vercel\/output\/static"\s*$/m.test(
    wrangler,
  )
) {
  errors.push("wrangler.toml: Pages output 設定が現行値ではありません。");
}
if (!/Cloudflare/i.test(read("docs/README.md"))) {
  errors.push("docs/README.md: 現行Cloudflare構成の記載がありません。");
}
if (packageJson.engines?.node !== ">=22 <23") {
  errors.push(
    `package.json: Node要件は\">=22 <23\"に統一してください。現在=${packageJson.engines?.node ?? "未設定"}`,
  );
}
if (read(".nvmrc").trim() !== "22") {
  errors.push(".nvmrc: 22である必要があります。");
}
if (/ViewAggregator|durable_objects/i.test(wrangler)) {
  errors.push("wrangler.toml: 未実装Durable Object設定・コメントを削除してください。");
}
if (/permission_mask/i.test(read("README.md"))) {
  errors.push("README.md: 権限正本をpermission_presetへ更新してください。");
}
if (/Durable Objects?/i.test(read("README.md"))) {
  errors.push("README.md: 未実装Durable Objectsを現行構成として記載しないでください。");
}
if (/Node(?:\.js)?\s*20|v20以上/i.test(read("DEPLOY.md"))) {
  errors.push("DEPLOY.md: Node.js要件を22.xへ統一してください。");
}
if (
  /自動セットアップ済み|バックグラウンドで起動済み|npm install 完了/i.test(
    read("LOCAL.md"),
  )
) {
  errors.push("LOCAL.md: 個人PC固有の実施済み状態を削除してください。");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[check:docs] ${error}`);
  process.exit(1);
}
console.log(
  "[check:docs] OK: active documentation metadata, links, npm scripts, vocabulary, and Cloudflare source alignment are valid.",
);

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredActive = [
  "README.md", "AGENTS.md", "LOCAL.md", "DEPLOY.md", "docs/README.md",
  "docs/operations/README.md", "docs/database/README.md", "docs/database/change-log.md",
];
const requiredPaths = [
  "docs/operations/migrations.md", "docs/operations/workers.md",
  "docs/operations/audit-and-restore.md", "docs/operations/legacy-import.md",
  "docs/operations/static-delivery.md", "docs/operations/incident-response.md",
];
const errors = [];
const localLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const forbiddenActive = [
  [/runtime[ -]migration/gi, "実行時migration"],
  [/db:generate/gi, "db:generate"],
  [/open.?next/gi, "OpenNext"],
  [/permission_mask/gi, "旧permission_mask"],
  [/ViewAggregator/gi, "未実装ViewAggregator"],
  [/Durable Objects?/gi, "未実装Durable Object"],
  [
    /バックグラウンドで起動済み|自動セットアップ済み|npm install 完了/gi,
    "個人PC固有の実施状態",
  ],
  [
    /Node\.js\s*20|Node\s*20|v20以上/gi,
    "旧Node.js 20要件",
  ],
  [
    /0021_slim_mvp_drop_unused_tables/gi,
    "旧migration固定参照",
  ],
];

function file(relative) { return path.join(root, relative); }
function read(relative) { return fs.readFileSync(file(relative), "utf8"); }
function historical(relative, text) {
  return relative.split(path.sep).some((part) => part === "historical" || part === "archive") || /Status:\s*Historical/i.test(text);
}
function checkLinks(relative, text) {
  for (const match of text.matchAll(localLinkPattern)) {
    const target = match[1].trim().split(/[?#]/, 1)[0];
    if (!target || /^(?:https?|mailto):/i.test(target) || target.startsWith("#") || target.startsWith("`") || target.includes("<")) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file(relative)), target))) errors.push(`${relative}: link先がありません: ${target}`);
  }
}

for (const relative of requiredActive) {
  if (!fs.existsSync(file(relative))) { errors.push(`${relative} がありません。`); continue; }
  const text = read(relative);
  if (!/Status:\s*Active/i.test(text)) errors.push(`${relative}: Status: Active がありません。`);
  if (!/Last verified:\s*\d{4}-\d{2}-\d{2}/i.test(text)) errors.push(`${relative}: Last verified metadata がありません。`);
  if (/\+\s*working tree/i.test(text)) {
    errors.push(
      `${relative}: 未コミット状態を検証根拠に含めないでください。`,
    );
  }
  checkLinks(relative, text);
}
for (const relative of requiredPaths) if (!fs.existsSync(file(relative))) errors.push(`${relative} がありません。`);

function collectActiveDocs(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !["historical", "archive"].includes(entry.name.toLowerCase())) {
      collectActiveDocs(path.join(dir, entry.name), result);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(path.join(dir, entry.name));
    }
  }
  return result;
}
for (const full of collectActiveDocs(file("docs"))) {
  const relative = path.relative(root, full);
  const text = fs.readFileSync(full, "utf8");
  if (historical(relative, text) || !/Status:\s*Active/i.test(text)) continue;
  for (const [pattern, label] of forbiddenActive) {
    if (pattern.test(text)) errors.push(`${relative}: Active文書に旧表現 ${label} が残っています。`);
    pattern.lastIndex = 0;
  }
  if (/Status:\s*Active/i.test(text)) checkLinks(relative, text);
}

const packageJson = JSON.parse(read("package.json"));
const wrangler = read("wrangler.toml");
if (!packageJson.devDependencies?.["@cloudflare/next-on-pages"]) errors.push("package.json: Pages adapter がありません。");
if (!/^pages_build_output_dir\s*=\s*"\.vercel\/output\/static"\s*$/m.test(wrangler)) errors.push("wrangler.toml: Pages output 設定が現行値ではありません。");
if (!/Cloudflare/i.test(read("docs/README.md"))) errors.push("docs/README.md: 現行Cloudflare構成の記載がありません。");

const packageNode =
  packageJson.engines?.node ?? "";

if (packageNode !== ">=22 <23") {
  errors.push(
    `package.json: Node要件は">=22 <23"に統一してください。現在=${packageNode}`,
  );
}

const nvmrc = read(".nvmrc").trim();
if (nvmrc !== "22") {
  errors.push(
    `.nvmrc: 22である必要があります。現在=${nvmrc}`,
  );
}

if (/ViewAggregator|durable_objects/i.test(wrangler)) {
  errors.push(
    "wrangler.toml: 未実装Durable Object設定・コメントを削除してください。",
  );
}

const readme = read("README.md");
if (/permission_mask/i.test(readme)) {
  errors.push(
    "README.md: 権限正本をpermission_presetへ更新してください。",
  );
}

if (/Durable Objects?/i.test(readme)) {
  errors.push(
    "README.md: 未実装Durable Objectsを現行構成として記載しないでください。",
  );
}

const deploy = read("DEPLOY.md");
if (/Node(?:\.js)?\s*20|v20以上/i.test(deploy)) {
  errors.push(
    "DEPLOY.md: Node.js要件を22.xへ統一してください。",
  );
}

const local = read("LOCAL.md");
if (
  /自動セットアップ済み|バックグラウンドで起動済み|npm install 完了/i.test(
    local,
  )
) {
  errors.push(
    "LOCAL.md: 個人PC固有の実施済み状態を削除してください。",
  );
}

if (errors.length) { for (const error of errors) console.error(`[check:docs] ${error}`); process.exit(1); }
console.log("[check:docs] OK: active documentation metadata, links, vocabulary, and Cloudflare source alignment are valid.");

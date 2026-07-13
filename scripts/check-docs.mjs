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

if (errors.length) { for (const error of errors) console.error(`[check:docs] ${error}`); process.exit(1); }
console.log("[check:docs] OK: active documentation metadata, links, vocabulary, and Cloudflare source alignment are valid.");

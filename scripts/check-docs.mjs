#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "README.md",
  "AGENTS.md",
  "LOCAL.md",
  "DEPLOY.md",
  "docs/README.md",
  "docs/operations/README.md",
  "docs/database/README.md",
  "docs/database/change-log.md",
];
const errors = [];

for (const relative of required) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    errors.push(`${relative} がありません。`);
    continue;
  }
  const text = fs.readFileSync(full, "utf8");
  if (!text.includes("Status: Active")) {
    errors.push(`${relative}: Active metadataがありません。`);
  }
}

for (const requiredPath of [
  "docs/operations/migrations.md",
  "docs/operations/workers.md",
  "docs/operations/audit-and-restore.md",
  "docs/operations/legacy-import.md",
  "docs/operations/static-delivery.md",
  "docs/operations/incident-response.md",
]) {
  if (!fs.existsSync(path.join(root, requiredPath))) errors.push(`${requiredPath} がありません。`);
}

if (errors.length) {
  for (const error of errors) console.error(`[check:docs] ${error}`);
  process.exit(1);
}
console.log("[check:docs] OK: active documentation index and metadata are present.");

#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const scripts = [
  "scripts/check-docs.mjs",
  "scripts/check-db-change-history.mjs",
  "scripts/check-db-schema.mjs",
];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("[check:project-docs] OK");

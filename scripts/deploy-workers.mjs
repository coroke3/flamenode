#!/usr/bin/env node
/**
 * workers/ 配下の 5 つの Cron Worker を順にデプロイする。
 */
import { execSync } from "node:child_process";
import path from "node:path";

const WORKERS = [
  "json-generator",
  "cleanup",
  "youtube-sync",
  "score-recalc",
  "notification-dispatcher",
];

function deploy(name) {
  const dir = path.join("workers", name);
  console.log(`\n=== deploy: ${name} ===`);
  execSync("npx wrangler deploy", {
    cwd: dir,
    stdio: "inherit",
  });
}

function main() {
  for (const name of WORKERS) {
    deploy(name);
  }
  console.log("\n[workers:deploy] すべて完了。");
}

main();

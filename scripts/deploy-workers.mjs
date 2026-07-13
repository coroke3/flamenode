#!/usr/bin/env node
/**
 * workers/ 配下の 3 つの Cron Worker を順にデプロイする。
 * 旧5本構成 (json-generator, cleanup, youtube-sync, score-recalc, notification-dispatcher)
 * から3本構成 (fast-jobs, content-jobs, sync-jobs) に統合済み。
 */
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const WORKERS = [
  "fast-jobs",
  "content-jobs",
  "sync-jobs",
];

if (
  process.env.CI === "1" &&
  !process.env.BUILD_COMMIT_SHA &&
  !process.env.GITHUB_SHA
) {
  throw new Error(
    "BUILD_COMMIT_SHA or GITHUB_SHA is required.",
  );
}

const commitSha =
  process.env.BUILD_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  "unknown";

function deploy(name) {
  const dir = path.join("workers", name);
  console.log(`\n=== deploy: ${name} ===`);
  execSync(
    `npx wrangler deploy --var BUILD_COMMIT_SHA:${commitSha}`,
    {
      cwd: dir,
      stdio: "inherit",
      env: process.env,
    },
  );
}

function main() {
  for (const name of WORKERS) {
    deploy(name);
  }
  console.log("\n[workers:deploy] すべて完了。");
}

main();

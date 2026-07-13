#!/usr/bin/env node
/**
 * background-jobsをdeployし、旧3 Cron Workerを削除する。
 * 新Workerのdeploy成功前には旧Workerを触らない。
 */
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const WORKER = "background-jobs";
const LEGACY_WORKERS = [
  "flamenode-fast-jobs",
  "flamenode-content-jobs",
  "flamenode-sync-jobs",
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

function deploy() {
  const dir = path.join("workers", WORKER);
  console.log(`\n=== deploy: ${WORKER} ===`);
  execSync(
    `npx wrangler deploy --var BUILD_COMMIT_SHA:${commitSha}`,
    {
      cwd: dir,
      stdio: "inherit",
      env: process.env,
    },
  );
}

function deleteLegacyWorkers() {
  for (const name of LEGACY_WORKERS) {
    console.log(`\n=== delete legacy worker: ${name} ===`);
    try {
      execSync(
        `npx wrangler delete --name ${name} --force`,
        {
          stdio: "inherit",
          env: process.env,
        },
      );
    } catch {
      console.warn(`[workers:deploy] legacy worker not deleted or already absent: ${name}`);
    }
  }
}

function main() {
  deploy();
  deleteLegacyWorkers();
  console.log("\n[workers:deploy] background-jobsへの統合完了。");
}

main();

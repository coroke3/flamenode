#!/usr/bin/env node
/**
 * background-jobsを先にdeployする。
 * 旧3 Cron Workerは、新Workerへのsecret設定・smoke確認後に
 * DELETE_LEGACY_WORKERS=1を明示した実行だけで削除する。
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
  process.env.SKIP_BACKGROUND_DEPLOY !== "1" &&
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
  if (process.env.SKIP_BACKGROUND_DEPLOY === "1") {
    console.log("\n[workers:deploy] background-jobsの再deployを省略します。");
    return;
  }

  const dir = path.join("workers", WORKER);
  const appOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vars = [
    `BUILD_COMMIT_SHA:${commitSha}`,
    ...(appOrigin ? [`APP_ORIGIN:${appOrigin}`] : []),
  ];
  console.log(`\n=== deploy: ${WORKER} ===`);
  execSync(
    `npx wrangler deploy ${vars.map((value) => `--var ${value}`).join(" ")}`,
    {
      cwd: dir,
      stdio: "inherit",
      env: process.env,
    },
  );
}

function deleteLegacyWorkers() {
  if (process.env.DELETE_LEGACY_WORKERS !== "1") {
    console.log(
      "\n[workers:deploy] 旧3 Workerは維持しました。" +
        "新Workerのsecret設定とsmoke確認後、DELETE_LEGACY_WORKERS=1で再実行してください。",
    );
    return;
  }

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
  console.log("\n[workers:deploy] background-jobsのdeploy処理完了。");
}

main();

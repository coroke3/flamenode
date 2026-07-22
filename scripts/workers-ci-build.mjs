#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isWorkersCi, runProcess } from "./cloudflare-production.mjs";
import { resolveNpmInvocation } from "./cloudflare-verify-fast.mjs";

export function runWorkersCiBuild({
  env = process.env,
  repoRoot = process.cwd(),
  run = runProcess,
  npmInvocation = resolveNpmInvocation({ env }),
  exists = fs.existsSync,
} = {}) {
  if (isWorkersCi(env)) {
    run({
      executable: npmInvocation.executable,
      args: [...npmInvocation.argsPrefix, "ci", "--no-audit", "--no-fund"],
      cwd: repoRoot,
      env,
      label: "workers-ci-build:npm-ci",
    });
    run({
      executable: npmInvocation.executable,
      args: [...npmInvocation.argsPrefix, "run", "cf:cloud-build"],
      cwd: repoRoot,
      env,
      label: "workers-ci-build:cf-cloud-build",
    });
    return "workers-ci";
  }

  const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  if (exists(nextBin)) {
    run({
      executable: process.execPath,
      args: [nextBin, "build"],
      cwd: repoRoot,
      env,
      label: "workers-ci-build:next-build",
    });
  } else {
    run({
      executable: env.CLOUDFLARE_NPM_BIN?.trim() || "npx",
      args: ["next", "build"],
      cwd: repoRoot,
      env,
      label: "workers-ci-build:next-build",
    });
  }
  return "next";
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    runWorkersCiBuild();
  } catch (error) {
    console.error(`[workers-ci-build] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}

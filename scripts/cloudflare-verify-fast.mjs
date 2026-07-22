#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runProcess } from "./cloudflare-production.mjs";

export const FAST_VERIFY_STEPS = Object.freeze([
  "typecheck",
  "lint",
  "test:critical",
  "test:workers",
  "test:cloudflare-ci",
  "check:cloudflare-template",
  "check:public-api-leaks",
]);

/** Workers Builds 向け。重い unit/lint は含めず deploy 契約検査だけにする。 */
export const CLOUD_BUILD_VERIFY_STEPS = Object.freeze([
  "test:cloudflare-ci",
  "check:cloudflare-template",
]);

export function resolveNpmInvocation({ env = process.env } = {}) {
  const explicitCli = env.CLOUDFLARE_NPM_CLI?.trim();
  if (explicitCli) {
    const cli = path.resolve(explicitCli);
    if (!fs.existsSync(cli) || !fs.statSync(cli).isFile()) {
      throw new Error("CLOUDFLARE_NPM_CLI must point to an existing npm CLI file.");
    }
    return { executable: process.execPath, argsPrefix: [cli] };
  }
  if (process.platform !== "win32") {
    return { executable: env.CLOUDFLARE_NPM_BIN?.trim() || "npm", argsPrefix: [] };
  }
  const candidates = [
    env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const cli = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!cli) {
    throw new Error("npm CLI could not be resolved for safe argv execution on Windows.");
  }
  return { executable: process.execPath, argsPrefix: [cli] };
}

function runVerificationSteps({
  steps,
  labelPrefix,
  env = process.env,
  repoRoot = process.cwd(),
  run = runProcess,
  npmInvocation = resolveNpmInvocation({ env }),
}) {
  const completed = [];
  for (const script of steps) {
    run({
      executable: npmInvocation.executable,
      args: [...npmInvocation.argsPrefix, "run", script],
      cwd: repoRoot,
      env,
      label: `${labelPrefix}:${script}`,
    });
    completed.push(script);
  }
  console.log(`[${labelPrefix}] OK (${completed.length} steps)`);
  return completed;
}

export function runFastVerification(options = {}) {
  return runVerificationSteps({
    ...options,
    steps: FAST_VERIFY_STEPS,
    labelPrefix: "cloudflare-verify-fast",
  });
}

export function runCloudBuildVerification(options = {}) {
  return runVerificationSteps({
    ...options,
    steps: CLOUD_BUILD_VERIFY_STEPS,
    labelPrefix: "cloudflare-verify-cloud",
  });
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const mode = process.argv[2] === "--cloud" ? "cloud" : "fast";
  try {
    if (mode === "cloud") {
      runCloudBuildVerification();
    } else {
      runFastVerification();
    }
  } catch (error) {
    console.error(
      `[${mode === "cloud" ? "cloudflare-verify-cloud" : "cloudflare-verify-fast"}] FAILED\n${error.message}`,
    );
    process.exitCode = 1;
  }
}

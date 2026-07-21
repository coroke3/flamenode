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

export function runFastVerification({
  env = process.env,
  repoRoot = process.cwd(),
  run = runProcess,
  npmInvocation = resolveNpmInvocation({ env }),
} = {}) {
  const completed = [];
  for (const script of FAST_VERIFY_STEPS) {
    run({
      executable: npmInvocation.executable,
      args: [...npmInvocation.argsPrefix, "run", script],
      cwd: repoRoot,
      env,
      label: `cloudflare-verify-fast:${script}`,
    });
    completed.push(script);
  }
  console.log(`[cloudflare-verify-fast] OK (${completed.length} steps)`);
  return completed;
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    runFastVerification();
  } catch (error) {
    console.error(`[cloudflare-verify-fast] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}

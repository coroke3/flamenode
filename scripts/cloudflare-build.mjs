#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertCommitSha,
  resolveTool,
  runProcess,
} from "./cloudflare-production.mjs";
import {
  checkOpenNextOutput,
  writeBuildManifest,
} from "./check-open-next-output.mjs";

export function resolveManagedBuildOutput({
  env = process.env,
  repoRoot = process.cwd(),
  exists = fs.existsSync,
  lstat = fs.lstatSync,
} = {}) {
  if (env.OPEN_NEXT_OUTPUT_DIR?.trim()) {
    throw new Error(
      "OPEN_NEXT_OUTPUT_DIR is not supported; build output is fixed to .open-next.",
    );
  }
  const root = path.resolve(repoRoot);
  const outputRoot = path.join(root, ".open-next");
  if (outputRoot === root || path.dirname(outputRoot) !== root) {
    throw new Error("Refusing to remove an unmanaged OpenNext output path.");
  }
  if (exists(outputRoot) && lstat(outputRoot).isSymbolicLink()) {
    throw new Error("Refusing to remove a symlinked OpenNext output path.");
  }
  return outputRoot;
}

export function runCloudflareBuild({
  env = process.env,
  repoRoot = process.cwd(),
  verifyCommit = assertCommitSha,
  run = runProcess,
  check = checkOpenNextOutput,
} = {}) {
  const commit = verifyCommit(env, repoRoot);
  const cli = resolveTool(
    repoRoot,
    "CLOUDFLARE_OPENNEXT_BIN",
    "node_modules/@opennextjs/cloudflare/dist/cli/index.js",
    env,
  );
  const legacyOutput = path.join(repoRoot, ".vercel", "output");
  if (fs.existsSync(legacyOutput)) fs.rmSync(legacyOutput, { recursive: true, force: true });
  const outputRoot = resolveManagedBuildOutput({ env, repoRoot });
  if (fs.existsSync(outputRoot)) fs.rmSync(outputRoot, { recursive: true, force: true });

  run({
    executable: process.execPath,
    args: [cli, "build"],
    cwd: repoRoot,
    env,
    label: "cloudflare-build:opennext",
  });
  writeBuildManifest({ outputRoot, commit });
  check({ env, repoRoot, outputRoot, commit });
  console.log("[cloudflare-build] OpenNext artifact verified (single build)");
  return { commit, outputRoot };
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    runCloudflareBuild();
  } catch (error) {
    console.error(`[cloudflare-build] FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}

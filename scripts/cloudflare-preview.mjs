#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gitHead, resolveTool } from "./cloudflare-production.mjs";
import { checkOpenNextOutput } from "./check-open-next-output.mjs";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

export function assertPreviewArtifact({
  repoRoot = process.cwd(),
  commit,
  env = process.env,
  readFile = fs.readFileSync,
  exists = fs.existsSync,
  validateOutput = checkOpenNextOutput,
} = {}) {
  const outputRoot = path.join(repoRoot, ".open-next");
  const manifestPath = path.join(outputRoot, "flamenode-build-manifest.json");
  const workerPath = path.join(outputRoot, "worker.js");
  let manifest;
  try {
    manifest = JSON.parse(readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(
      "OpenNext build manifest is missing or invalid; run npm run cf:build before preview.",
    );
  }
  if (manifest?.formatVersion !== 1 || manifest.commit !== commit) {
    throw new Error(
      "OpenNext build manifest does not match git HEAD; rebuild before preview.",
    );
  }
  if (!exists(workerPath)) {
    throw new Error(
      "OpenNext worker artifact is missing; run npm run cf:build before preview.",
    );
  }
  validateOutput({
    env: { ...env, WORKERS_CI_COMMIT_SHA: commit },
    repoRoot,
    outputRoot,
    commit,
  });
}

export function buildPreviewInvocation({
  env = process.env,
  repoRoot = process.cwd(),
  resolveCommit = gitHead,
  validateArtifact = assertPreviewArtifact,
} = {}) {
  const commit = resolveCommit(repoRoot).trim().toLowerCase();
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("git HEAD must be a 40-character commit SHA");
  }
  validateArtifact({ repoRoot, commit, env });
  const rawPort = env.FLAMENODE_PREVIEW_PORT?.trim() || "3000";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error("FLAMENODE_PREVIEW_PORT must be an integer from 1 to 65535");
  }
  const wrangler = resolveTool(
    repoRoot,
    "CLOUDFLARE_WRANGLER_BIN",
    "node_modules/wrangler/bin/wrangler.js",
    env,
  );
  return {
    executable: process.execPath,
    args: [
      wrangler,
      "dev",
      "--config",
      "wrangler.toml",
      "--port",
      rawPort,
      "--var",
      "FLAMENODE_LOCAL_PREVIEW:1",
      "--var",
      `BUILD_COMMIT_SHA:${commit}`,
    ],
  };
}

export function runPreview(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const invocation = buildPreviewInvocation({ ...options, repoRoot });
  const result = (options.spawn ?? spawnSync)(
    invocation.executable,
    invocation.args,
    {
      cwd: repoRoot,
      env: options.env ?? process.env,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `wrangler preview exited with status ${result.status ?? "unknown"}`,
    );
  }
}

function isMain() {
  return (
    Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  try {
    runPreview();
  } catch (error) {
    console.error(
      `[cloudflare-preview] FAILED: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}

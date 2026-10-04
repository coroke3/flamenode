#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertCommitSha,
  redactOutput,
  resolveTool,
  runProcess,
} from "./cloudflare-production.mjs";
import {
  checkOpenNextOutput,
  writeBuildManifest,
} from "./check-open-next-output.mjs";

const EXPECTED_BUILD_BINDING_WARNING =
  /\{"service":"public-static-json","object_key":"[^"]+","result":"read_failed","error_name":"CloudflareBindingsUnavailableError"\}/;

export function filterExpectedOpenNextBuildNoise(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .filter((line) => !EXPECTED_BUILD_BINDING_WARNING.test(line.trim()))
    .join("\n")
    .trim();
}

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

// ISR routes are prerendered at build time, where Cloudflare bindings are
// unavailable, so their cached HTML carries the "取得できません" notice.
// `opennextjs-cloudflare deploy` uploads this cache to R2 with the deploy time
// as its age, which would serve that notice to every visitor for the route's
// whole revalidate window after each deploy. Dropping the entries makes the
// first runtime request render with bindings instead.
export function dropBuildTimeIsrCache({ repoRoot, outputRoot }) {
  const nextDir = path.join(repoRoot, ".next");
  const buildId = fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
  const { routes } = JSON.parse(
    fs.readFileSync(path.join(nextDir, "prerender-manifest.json"), "utf8"),
  );
  const cacheDir = path.join(outputRoot, "cache", buildId);
  const dropped = [];
  for (const [route, { initialRevalidateSeconds }] of Object.entries(routes)) {
    if (typeof initialRevalidateSeconds !== "number") continue;
    const file = path.join(cacheDir, `${route === "/" ? "index" : route.slice(1)}.cache`);
    if (!fs.existsSync(file)) {
      throw new Error(`Build-time ISR cache entry for ${route} is missing; the OpenNext cache layout changed.`);
    }
    fs.rmSync(file);
    dropped.push(route);
  }
  return dropped;
}

export function runCloudflareBuild({
  env = process.env,
  repoRoot = process.cwd(),
  verifyCommit = assertCommitSha,
  run = runProcess,
  check = checkOpenNextOutput,
  dropIsrCache = dropBuildTimeIsrCache,
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

  const result = run({
    executable: process.execPath,
    args: [cli, "build"],
    cwd: repoRoot,
    env: {
      ...env,
      NEXT_TELEMETRY_DISABLED: env.NEXT_TELEMETRY_DISABLED || "1",
    },
    label: "cloudflare-build:opennext",
    allowOutput: false,
  });
  const stdout = filterExpectedOpenNextBuildNoise(redactOutput(result?.stdout, env));
  const stderr = filterExpectedOpenNextBuildNoise(redactOutput(result?.stderr, env));
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);

  const dropped = dropIsrCache({ repoRoot, outputRoot });
  console.log(`[cloudflare-build] dropped build-time ISR cache: ${dropped.join(", ") || "none"}`);
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

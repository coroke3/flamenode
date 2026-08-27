#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertCommitSha,
  SENSITIVE_ENV_NAMES,
} from "./cloudflare-production.mjs";

const MANIFEST_NAME = "flamenode-build-manifest.json";
const FORBIDDEN_PATH_PATTERN = /(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars|ids\.json|wrangler\.(?:toml|jsonc))$/i;
const TEXT_EXTENSIONS = new Set([
  "", ".css", ".html", ".js", ".json", ".map", ".mjs", ".svg", ".txt", ".xml",
]);

function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

function nonEmptyDirectory(directory) {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory() && listFiles(directory).length > 0;
}

function parseDevVars(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

function sensitiveValues(env, repoRoot) {
  const names = [...SENSITIVE_ENV_NAMES, "CF_D1_DATABASE_ID", "CF_KV_NAMESPACE_ID", "CF_R2_BUCKET_NAME"];
  const local = parseDevVars(path.join(repoRoot, ".dev.vars"));
  const entries = [];
  for (const name of names) {
    const runtimeValue = typeof env[name] === "string" ? env[name].trim() : "";
    const localValue = typeof local[name] === "string" ? local[name].trim() : "";
    if (runtimeValue.length >= 4) entries.push([name, runtimeValue]);
    if (localValue.length >= 4 && localValue !== runtimeValue) {
      entries.push([`.dev.vars:${name}`, localValue]);
    }
  }
  return entries;
}

export function writeBuildManifest({
  outputRoot = path.resolve(".open-next"),
  commit,
} = {}) {
  fs.mkdirSync(outputRoot, { recursive: true });
  const manifestPath = path.join(outputRoot, MANIFEST_NAME);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ formatVersion: 1, commit }, null, 2)}\n`,
    "utf8",
  );
  return manifestPath;
}

export function checkOpenNextOutput({
  env = process.env,
  repoRoot = process.cwd(),
  outputRoot = path.resolve(repoRoot, ".open-next"),
  commit = assertCommitSha(env, repoRoot),
  requireLegacyPagesAbsent = true,
} = {}) {
  const errors = [];
  const workerPath = path.join(outputRoot, "worker.js");
  const assetsPath = path.join(outputRoot, "assets");
  const manifestPath = path.join(outputRoot, MANIFEST_NAME);
  const webmanifestPath = path.join(assetsPath, "manifest.webmanifest");
  const serverConfigPath = path.join(
    outputRoot,
    "server-functions",
    "default",
    "open-next.config.mjs",
  );

  if (!fs.existsSync(workerPath) || !fs.statSync(workerPath).isFile() || fs.statSync(workerPath).size === 0) {
    errors.push("worker.js is missing or empty");
  }
  if (!nonEmptyDirectory(assetsPath)) errors.push("assets directory is missing or empty");
  if (!fs.existsSync(webmanifestPath) || !fs.statSync(webmanifestPath).isFile()) {
    errors.push("assets/manifest.webmanifest is missing; it must be served as a Static Asset");
  }
  if (!fs.existsSync(serverConfigPath) || !fs.statSync(serverConfigPath).isFile()) {
    errors.push("default server OpenNext config is missing");
  } else {
    const serverConfig = fs.readFileSync(serverConfigPath, "utf8");
    const usesOnDemandRouteLoading =
      /routePreloadingBehavior\s*:\s*["']none["']/.test(serverConfig);
    const usesAllRoutePreloading =
      /routePreloadingBehavior\s*:\s*["'](?:withWaitUntil|onStart|onWarmerEvent)["']/.test(
        serverConfig,
      );
    if (!usesOnDemandRouteLoading || usesAllRoutePreloading) {
      errors.push("default server must use on-demand route loading (routePreloadingBehavior: none)");
    }
  }
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    errors.push(`${MANIFEST_NAME} is missing`);
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.formatVersion !== 1 || manifest.commit !== commit) {
        errors.push(`${MANIFEST_NAME} does not match WORKERS_CI_COMMIT_SHA`);
      }
    } catch {
      errors.push(`${MANIFEST_NAME} is malformed`);
    }
  }

  if (requireLegacyPagesAbsent && fs.existsSync(path.join(repoRoot, ".vercel", "output"))) {
    errors.push("legacy Pages output .vercel/output must not exist");
  }

  if (fs.existsSync(outputRoot)) {
    const secrets = sensitiveValues(env, repoRoot);
    for (const filePath of listFiles(outputRoot)) {
      const relative = path.relative(outputRoot, filePath).replaceAll("\\", "/");
      if (FORBIDDEN_PATH_PATTERN.test(relative) || relative === "_routes.json" || relative === "_worker.js") {
        errors.push(`${relative}: forbidden Pages/config artifact`);
        continue;
      }
      const stat = fs.statSync(filePath);
      if (stat.size > 32 * 1024 * 1024) {
        errors.push(`${relative}: file exceeds the 32 MiB artifact inspection limit`);
        continue;
      }
      const buffer = fs.readFileSync(filePath);
      for (const [name, secret] of secrets) {
        if (buffer.includes(Buffer.from(secret))) {
          errors.push(`${relative}: contains sensitive value from ${name}`);
        }
      }
      if (TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        const text = buffer.toString("utf8");
        if (/@cloudflare\/next-on-pages|pages_build_output_dir|\.vercel\/output/i.test(text)) {
          errors.push(`${relative}: contains legacy Pages adapter/output reference`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`OpenNext output verification failed:\n- ${errors.join("\n- ")}`);
  }
  return { outputRoot, workerPath, assetsPath, manifestPath, commit };
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  try {
    checkOpenNextOutput();
    console.log("[check-open-next-output] OK");
  } catch (error) {
    console.error(`[check-open-next-output] FAILED\n- ${error.message}`);
    process.exitCode = 1;
  }
}

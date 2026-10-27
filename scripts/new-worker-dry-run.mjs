/**
 * MIG-0628 U03: a fixed, non-production Wrangler dry-run gate.
 *
 * The workflow MUST NOT embed "wrangler deploy" directly: the repo's
 * cloudflare-ci safety policy rejects deployment commands in Actions YAML.
 * Instead this audited wrapper pins --dry-run, disallows arbitrary arguments,
 * invokes only the three tracked target configs via the locally installed
 * Wrangler JS entrypoint (never npx.cmd/shell), and never contacts the account
 * for IDs or secrets. CI only; no production command is exported.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Using the JS entrypoint avoids Win32 .cmd execution (shell:false), and
// prevents npx from resolving a different Wrangler or installing a package.
export const WRANGLER_CLI = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
export const WORKER_TARGETS = Object.freeze([
  Object.freeze({ name: "site", config: "apps/site/wrangler.toml", built: "apps/site/dist" }),
  Object.freeze({ name: "api", config: "apps/api/wrangler.toml", built: "apps/api/src/index.ts" }),
  Object.freeze({ name: "app", config: "apps/app/wrangler.toml", built: "apps/app/dist" }),
]);

/** Argument vector, never a shell command. No route/custom-domain flags. */
export function dryRunArgs(target, outdir) {
  if (!WORKER_TARGETS.includes(target)) throw new Error("Unknown or mutable Worker target");
  if (!path.isAbsolute(outdir)) throw new Error("Outdir must be absolute");
  return [WRANGLER_CLI, "deploy", "--dry-run",
    "--outdir", outdir, "--config", target.config];
}

export function dryRunPlan(tmpdir) {
  const base = tmpdir || path.join(os.tmpdir(), "flamenode-new-worker-dry-run");
  return WORKER_TARGETS.map(target => ({
    name: target.name, config: target.config, built: target.built,
    executable: process.execPath,
    args: dryRunArgs(target, path.resolve(base, target.name)),
  }));
}

/**
 * Reject altered plans before performing any filesystem checks or spawning a
 * subprocess. Merely checking args.includes("--dry-run") is insufficient:
 * a trailing --env, --name, --route or a replaced --config may still deploy
 * a different target while retaining that flag.
 */
export function assertFixedDryRunPlan(plan) {
  if (!Array.isArray(plan) || plan.length !== WORKER_TARGETS.length) {
    throw new Error("Dry-run plan must contain exactly three fixed Workers");
  }
  for (const [i, entry] of plan.entries()) {
    const target = WORKER_TARGETS[i];
    if (!entry || entry.name !== target.name ||
        entry.config !== target.config || entry.built !== target.built ||
        entry.executable !== process.execPath || !Array.isArray(entry.args)) {
      throw new Error("Mutated Worker target or executable forbidden");
    }
    const outdir = entry.args[4];
    if (typeof outdir !== "string" || !path.isAbsolute(outdir)) {
      throw new Error("Dry-run output directory must be absolute");
    }
    const expected = dryRunArgs(target, outdir);
    if (entry.args.length !== expected.length ||
        entry.args.some((arg, j) => arg !== expected[j])) {
      throw new Error("Mutated or extra Wrangler deployment flags forbidden");
    }
  }
}

/** Building an empty directory is not enough to validate a static Worker. */
export function assertBuiltEntrypoints(plan, inspect = statSync) {
  assertFixedDryRunPlan(plan);
  for (const entry of plan) {
    const relative = entry.name === "api" ? entry.built : path.join(entry.built, "index.html");
    let valid = false;
    try {
      const info = inspect(path.join(ROOT, relative));
      valid = info.isFile() && info.size > 0;
    } catch {
      // Missing files, unreadable paths and symbolic build placeholders fail closed.
    }
    if (!valid) throw new Error("Missing or empty Worker build entrypoint: " + relative);
  }
}

export function assertDryRunInputs(plan) {
  assertFixedDryRunPlan(plan);
  if (!existsSync(WRANGLER_CLI)) {
    throw new Error("Local Wrangler CLI missing; run npm ci first");
  }
  for (const entry of plan) {
    if (!existsSync(path.join(ROOT, entry.config))) {
      throw new Error("Missing Worker config for dry-run: " + entry.config);
    }
  }
  assertBuiltEntrypoints(plan);
}

// Avoid both inherited API credentials and cached Wrangler OAuth credentials.
// Local dry-run packaging needs no account profile or production access.
const CLOUDFLARE_AUTH_KEY =
  /^(?:CLOUDFLARE_|CF_)(?:API_TOKEN|API_KEY|EMAIL|ACCOUNT_ID)$/i;

export function offlineWranglerEnv(parent = process.env, isolatedProfile) {
  const env = { ...parent, CI: "true", WRANGLER_SEND_METRICS: "false" };
  for (const key of Object.keys(env)) {
    if (CLOUDFLARE_AUTH_KEY.test(key)) delete env[key];
  }
  if (isolatedProfile !== undefined) {
    if (typeof isolatedProfile !== "string" || !path.isAbsolute(isolatedProfile)) {
      throw new Error("Wrangler profile directory must be absolute");
    }
    // Preserve PATH / system runtime variables, but prevent an existing login
    // or cache in HOME/APPDATA from being selected by the local CLI.
    for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
      env[key] = isolatedProfile;
    }
  }
  return env;
}

function main(argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--plan")) {
    throw new Error("Only --plan is supported; arbitrary deployment flags forbidden");
  }
  const plan = dryRunPlan();
  if (argv[0] === "--plan") {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    return;
  }
  assertDryRunInputs(plan);
  const isolatedProfile = mkdtempSync(path.join(os.tmpdir(), "flamenode-wrangler-offline-"));
  try {
    for (const item of plan) {
      const out = spawnSync(item.executable, item.args, {
        cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], shell: false,
        timeout: 240_000, // Fail closed instead of hanging on an unexpected prompt.
        env: offlineWranglerEnv(process.env, isolatedProfile),
      });
      if (out.error) throw out.error;
      if (out.status !== 0) throw new Error(item.name + " Wrangler local dry-run failed: " + out.status);
    }
  } finally {
    rmSync(isolatedProfile, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

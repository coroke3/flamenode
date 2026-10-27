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
import { existsSync } from "node:fs";
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

export function assertDryRunInputs(plan) {
  assertFixedDryRunPlan(plan);
  if (!existsSync(WRANGLER_CLI)) {
    throw new Error("Local Wrangler CLI missing; run npm ci first");
  }
  for (const entry of plan) {
    for (const p of [entry.config, entry.built]) {
      if (!existsSync(path.join(ROOT, p))) {
        throw new Error("Missing local build/config for dry-run: " + p);
      }
    }
  }
}

// A dry-run must not inherit account credentials from a developer workstation
// or a CI job with Cloudflare access. This also prevents Wrangler from using
// those values for an accidental account lookup during local packaging.
const CLOUDFLARE_AUTH_KEYS = Object.freeze([
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID", "CF_API_TOKEN", "CF_API_KEY",
  "CF_EMAIL", "CF_ACCOUNT_ID",
]);

export function offlineWranglerEnv(parent = process.env) {
  const env = { ...parent, CI: "true", WRANGLER_SEND_METRICS: "false" };
  for (const key of CLOUDFLARE_AUTH_KEYS) delete env[key];
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
  for (const item of plan) {
    const out = spawnSync(item.executable, item.args, {
      cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], shell: false,
      timeout: 240_000, // Fail closed instead of hanging on an unexpected prompt.
      env: offlineWranglerEnv(),
    });
    if (out.error) throw out.error;
    if (out.status !== 0) throw new Error(item.name + " Wrangler local dry-run failed: " + out.status);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

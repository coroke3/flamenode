/**
 * MIG-0628 U03: a fixed, non-production Wrangler dry-run gate.
 *
 * The workflow MUST NOT embed "wrangler deploy" directly: the repo's
 * cloudflare-ci safety policy rejects deployment commands in Actions YAML.
 * Instead this audited wrapper pins --dry-run, disallows arbitrary arguments,
 * invokes only the three tracked target configs, and never contacts the account
 * for IDs or secrets. CI only; no production command is exported.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORKER_TARGETS = Object.freeze([
  Object.freeze({ name: "site", config: "apps/site/wrangler.toml", built: "apps/site/dist" }),
  Object.freeze({ name: "api", config: "apps/api/wrangler.toml", built: "apps/api/src/index.ts" }),
  Object.freeze({ name: "app", config: "apps/app/wrangler.toml", built: "apps/app/dist" }),
]);

/** Argument vector, never a shell command. No route/custom-domain flags. */
export function dryRunArgs(target, outdir) {
  if (!WORKER_TARGETS.includes(target)) throw new Error("Unknown or mutable Worker target");
  if (!path.isAbsolute(outdir)) throw new Error("Outdir must be absolute");
  return ["--no-install", "wrangler", "deploy", "--dry-run",
    "--outdir", outdir, "--config", target.config];
}

export function dryRunPlan(tmpdir) {
  const base = tmpdir || path.join(os.tmpdir(), "flamenode-new-worker-dry-run");
  return WORKER_TARGETS.map(target => ({
    name: target.name, config: target.config, built: target.built,
    executable: process.platform === "win32" ? "npx.cmd" : "npx",
    args: dryRunArgs(target, path.resolve(base, target.name)),
  }));
}

export function assertDryRunInputs(plan) {
  for (const entry of plan) {
    for (const p of [entry.config, entry.built]) {
      if (!existsSync(path.join(ROOT, p))) {
        throw new Error("Missing local build/config for dry-run: " + p);
      }
    }
    if (!entry.args.includes("--dry-run") || entry.args.includes("--env")) {
      throw new Error("Non-dry-run or environment-specific deploy forbidden");
    }
  }
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
      cwd: ROOT, stdio: "inherit", shell: false,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    });
    if (out.error) throw out.error;
    if (out.status !== 0) throw new Error(item.name + " Wrangler local dry-run failed: " + out.status);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

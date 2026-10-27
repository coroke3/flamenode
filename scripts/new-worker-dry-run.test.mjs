// MIG-0628 — fixed no-upload dry-run wrapper regression (zero Cloudflare mutations).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { WORKER_TARGETS, WRANGLER_CLI, dryRunArgs, dryRunPlan } from "./new-worker-dry-run.mjs";

test("MIG-0628 U03: exactly site, api, app and only fixed --dry-run commands", () => {
  assert.deepEqual(WORKER_TARGETS.map(w => w.name), ["site", "api", "app"]);
  const outdir = path.resolve("flamenode-mig-0628-test-output");
  const plan = dryRunPlan(outdir);
  assert.equal(plan.length, 3);
  for (const [i, x] of plan.entries()) {
    assert.equal(x.executable, process.execPath, "Always execute JS via Node, not npx.cmd");
    assert.deepEqual(x.args,
      [WRANGLER_CLI, "deploy", "--dry-run",
        "--outdir", path.join(outdir, x.name), "--config", WORKER_TARGETS[i].config]);
    assert.match(WRANGLER_CLI, /node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/);
    assert.ok(!/\.(?:cmd|bat)$/i.test(x.executable));
    assert.ok(x.args.includes("--dry-run"));
    assert.ok(!x.args.some(a => /^(?:--env|--route|--name|--legacy-env)$/.test(a)));
    assert.match(x.config, /^apps\/(?:site|api|app)\/wrangler\.toml$/);
  }
});

test("MIG-0628 U03: mutable Worker target and relative output cannot bypass the guard", () => {
  assert.throws(() => dryRunArgs({ name: "prod", config: "wrangler.toml" }, "/tmp/test"), /Unknown/);
  assert.throws(() => dryRunArgs(WORKER_TARGETS[0], "../unexpected"), /absolute/);
});

test("MIG-0628 U03: --plan is purely local, rejects all deploy/remote flags", () => {
  const script = fileURLToPath(new URL("./new-worker-dry-run.mjs", import.meta.url));
  const plan = spawnSync(process.execPath, [script, "--plan"], { encoding: "utf8" });
  assert.equal(plan.status, 0, plan.stderr);
  const records = JSON.parse(plan.stdout);
  assert.deepEqual(records.map(r => r.name), ["site", "api", "app"]);
  const forbidden = spawnSync(process.execPath, [script, "--env", "production"], { encoding: "utf8" });
  assert.notEqual(forbidden.status, 0);
  assert.match(forbidden.stderr, /arbitrary deployment flags forbidden/);
});

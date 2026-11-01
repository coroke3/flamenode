// MIG-0628 — fixed no-upload dry-run wrapper regression (zero Cloudflare mutations).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { WORKER_TARGETS, WRANGLER_CLI, assertBuiltEntrypoints, assertFixedDryRunPlan, dryRunArgs, dryRunPlan, offlineWranglerEnv } from "./new-worker-dry-run.mjs";

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


test("MIG-0628 U03: altered or extra Wrangler flags never reach spawn", () => {
  const validPlan = () => structuredClone(dryRunPlan(path.resolve("dry-run-test-output")));
  assert.doesNotThrow(() => assertFixedDryRunPlan(validPlan()));

  const reject = (mutate) => {
    const plan = validPlan();
    mutate(plan);
    assert.throws(() => assertFixedDryRunPlan(plan),
      /(?:Mutated|fixed Workers|output directory)/);
  };
  reject(plan => { plan[0].args.push("--route", "example.com/*"); });
  reject(plan => { plan[0].args.push("--env", "production"); });
  reject(plan => { plan[1].args[6] = "wrangler.toml"; });
  reject(plan => { plan[2].args[2] = "deploy"; });
  reject(plan => { plan[0].args[0] = "/usr/local/bin/unsafe-wrapper"; });
  reject(plan => { plan[0].args[4] = "../not-absolute"; });
  reject(plan => { plan[1].executable = "npx"; });
  reject(plan => { plan[1].name = "flamenode-web"; });
  reject(plan => { plan[0].built = "some-other-path"; });
  reject(plan => { plan.pop(); });
  reject(plan => { plan.reverse(); });
});


test("MIG-0628 U03: an existing directory does not count as a built static Worker", () => {
  const plan = dryRunPlan(path.resolve("dry-run-artifact-fixture"));
  const expected = ["apps/site/dist/index.html", "apps/api/src/index.ts",
    "apps/app/dist/index.html"].map((entry) => path.join(entry));
  const seen = [];
  const inspect = (entry) => {
    seen.push(entry);
    return { isFile: () => true, isSymbolicLink: () => false, size: 42 };
  };
  assert.doesNotThrow(() => assertBuiltEntrypoints(plan, inspect));
  assert.deepEqual(seen.map(entry => path.relative(path.resolve("."), entry)), expected);

  for (const failed of [0, 1, 2]) {
    const target = seen[failed];
    assert.throws(() => assertBuiltEntrypoints(plan, (entry) =>
      entry === target ? { isFile: () => true, isSymbolicLink: () => false, size: 0 } : inspect(entry)),
    /Missing or empty Worker build entrypoint/);
    assert.throws(() => assertBuiltEntrypoints(plan, (entry) =>
      entry === target ? { isFile: () => false, isSymbolicLink: () => false, size: 900 } : inspect(entry)),
    /Missing or empty Worker build entrypoint/);
    assert.throws(() => assertBuiltEntrypoints(plan, (entry) =>
      entry === target
        ? { isFile: () => true, isSymbolicLink: () => true, size: 900 }
        : inspect(entry)),
    /Missing or empty Worker build entrypoint/,
    "a symlink to a real nonempty file must fail closed");
    assert.throws(() => assertBuiltEntrypoints(plan, (entry) => {
      if (entry === target) throw new Error("ENOENT");
      return inspect(entry);
    }), /Missing or empty Worker build entrypoint/);
  }
});

test("MIG-0628 U03: dry-run never inherits Cloudflare account credentials", () => {
  const secret = "DO_NOT_LEAK_SAMPLE_TOKEN";
  const parent = {
    PATH: "/usr/bin",
    HOME: "/example-home",
    CI: "false",
    WRANGLER_SEND_METRICS: "true",
    CLOUDFLARE_API_TOKEN: secret,
    CLOUDFLARE_API_KEY: secret,
    CLOUDFLARE_EMAIL: "secret@example.invalid",
    CLOUDFLARE_ACCOUNT_ID: secret,
    CF_API_TOKEN: secret,
    CF_API_KEY: secret,
    CF_EMAIL: "secret@example.invalid",
    CF_ACCOUNT_ID: secret,
    cloudflare_api_token: secret,
    cf_account_id: secret,
  };
  const sanitized = offlineWranglerEnv(parent);
  assert.equal(sanitized.CI, "true");
  assert.equal(sanitized.WRANGLER_SEND_METRICS, "false");
  assert.equal(sanitized.PATH, parent.PATH);
  assert.equal(sanitized.HOME, parent.HOME);
  for (const key of [
    "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL",
    "CLOUDFLARE_ACCOUNT_ID", "CF_API_TOKEN", "CF_API_KEY",
    "CF_EMAIL", "CF_ACCOUNT_ID",
  ]) assert.equal(Object.hasOwn(sanitized, key), false, key);
  assert.equal(Object.hasOwn(sanitized, "cloudflare_api_token"), false);
  assert.equal(Object.hasOwn(sanitized, "cf_account_id"), false);
  assert.equal(parent.CLOUDFLARE_API_TOKEN, secret,
    "Sanitizing the child must not mutate parent env");
});

test("MIG-0628 U03: offline Wrangler uses an empty temporary login profile", () => {
  const isolated = mkdtempSync(path.join(os.tmpdir(), "flamenode-mig-0628-profile-test-"));
  const parent = {
    PATH: "test-node-bin", HOME: "/home/existing-wrangler-login",
    USERPROFILE: "C:\\Users\\logged-in", APPDATA: "C:\\Users\\logged-in\\AppData\\Roaming",
    XDG_CONFIG_HOME: "/home/existing-wrangler-login/.config",
    CLOUDFLARE_API_TOKEN: "SAMPLE_DO_NOT_LEAK",
  };
  try {
    const env = offlineWranglerEnv(parent, isolated);
    for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
      assert.equal(env[key], isolated, key + " must not select saved Wrangler credentials");
    }
    assert.equal(env.PATH, parent.PATH);
    assert.equal(Object.hasOwn(env, "CLOUDFLARE_API_TOKEN"), false);
    assert.equal(parent.HOME, "/home/existing-wrangler-login");
    assert.throws(() => offlineWranglerEnv(parent, "relative/config-home"), /must be absolute/);
    assert.throws(() => offlineWranglerEnv(parent, null), /must be absolute/);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
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

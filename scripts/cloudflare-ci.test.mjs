import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const checker = path.join(root, "scripts", "check-cloudflare-config.mjs");

function run(env) {
  return execFileSync(process.execPath, [checker], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("production config check fails closed without Cloudflare secrets", () => {
  assert.throws(() => run({
    CLOUDFLARE_CONFIG_MODE: "production",
    CLOUDFLARE_API_TOKEN: "",
    CLOUDFLARE_ACCOUNT_ID: "",
    CF_IDS_JSON: "",
  }));
});

test("fixture config check is explicitly separate and accepts template IDs", () => {
  assert.doesNotThrow(() => run({
    CLOUDFLARE_CONFIG_MODE: "fixture",
    CLOUDFLARE_API_TOKEN: "",
    CLOUDFLARE_ACCOUNT_ID: "",
    CF_IDS_JSON: "",
  }));
});

test("deploy workflow preserves immutable artifact and deployment order", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-cloudflare.yml"), "utf8");
  assert.doesNotMatch(workflow, /^\s+push:\s*$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /name: pages-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /actions\/download-artifact@v4[\s\S]*name: pages-\$\{\{ github\.sha \}\}/);
  assert.ok(workflow.indexOf("migrate-d1:") < workflow.indexOf("deploy-pages:"));
  assert.ok(workflow.indexOf("deploy-pages:") < workflow.indexOf("deploy-workers:"));
  assert.ok(workflow.indexOf("deploy-workers:") < workflow.indexOf("smoke-production:"));
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: deploy-cloudflare-production/);
});

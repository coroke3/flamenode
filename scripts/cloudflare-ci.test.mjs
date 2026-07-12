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

function failureOutput(env) {
  try {
    run(env);
    assert.fail("expected checker to fail");
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

const productionBase = {
  CLOUDFLARE_CONFIG_MODE: "production",
  CLOUDFLARE_API_TOKEN: "token-value-is-not-logged",
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
};

test("production config check rejects malformed JSON without logging its value", () => {
  const output = failureOutput({ ...productionBase, CF_IDS_JSON: "{malformed-secret-payload" });
  assert.match(output, /CF_IDS_JSON must be valid JSON/);
  assert.doesNotMatch(output, /malformed-secret-payload/);
});

test("production config check rejects non-object and wrong-typed ID payloads", () => {
  const output = failureOutput({ ...productionBase, CF_IDS_JSON: JSON.stringify(["not-an-object"]) });
  assert.match(output, /CF_IDS_JSON must be a plain object/);

  const wrongTypes = failureOutput({
    ...productionBase,
    CF_IDS_JSON: JSON.stringify({
      d1_database_id: 123,
      kv_namespace_id: null,
      kv_preview_id: ["id"],
      d1_database_name: 123,
      r2_bucket_name: null,
      pages_project_name: false,
    }),
  });
  for (const name of ["d1_database_id", "kv_namespace_id", "kv_preview_id", "d1_database_name", "r2_bucket_name", "pages_project_name"]) {
    assert.match(wrongTypes, new RegExp(`CF_IDS_JSON\\.${name}`));
  }
});

test("production config check rejects short and zero IDs", () => {
  const output = failureOutput({
    ...productionBase,
    CLOUDFLARE_ACCOUNT_ID: "short-account-id",
    CF_IDS_JSON: JSON.stringify({
      d1_database_id: "00000000-0000-0000-0000-000000000000",
      kv_namespace_id: "0",
      kv_preview_id: "00000000000000000000000000000000",
      d1_database_name: "db",
      r2_bucket_name: "bucket",
      pages_project_name: "pages",
    }),
  });
  assert.match(output, /CF_IDS_JSON\.d1_database_id/);
  assert.match(output, /CF_IDS_JSON\.kv_namespace_id/);
  assert.match(output, /CF_IDS_JSON\.kv_preview_id/);
  assert.match(output, /CLOUDFLARE_ACCOUNT_ID/);
});

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

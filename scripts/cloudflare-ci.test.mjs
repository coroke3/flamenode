import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const checker = path.join(root, "scripts", "check-cloudflare-config.mjs");
const pagesChecker = path.join(root, "scripts", "check-pages-output.mjs");

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

function runFailure(command, env) {
  try {
    execFileSync(process.execPath, [command], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
    assert.fail("expected command to fail");
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

test("production config check ignores fixture root override", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-cloudflare-production-root-"));
  try {
    const output = failureOutput({
      ...productionBase,
      CLOUDFLARE_CONFIG_ROOT: fixtureRoot,
      CF_IDS_JSON: JSON.stringify({
        d1_database_id: "12345678-1234-1234-1234-123456789abc",
        kv_namespace_id: "123456789abcdef0123456789abcdef0",
        kv_preview_id: "abcdef0123456789abcdef0123456789",
        d1_database_name: "flamenode-db",
        r2_bucket_name: "flamenode-assets",
        pages_project_name: "flamenode",
      }),
    });
    assert.match(output, /wrangler\.toml:\d+: D1 database_id must be a non-zero UUID/);
    assert.doesNotMatch(output, /required Cloudflare configuration file is missing/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("fixture config check is explicitly separate and accepts template IDs", () => {
  assert.doesNotThrow(() => run({
    CLOUDFLARE_CONFIG_MODE: "fixture",
    CLOUDFLARE_API_TOKEN: "",
    CLOUDFLARE_ACCOUNT_ID: "",
    CF_IDS_JSON: "",
  }));
});

test("Cloudflare config check fails closed when a required wrangler file is missing", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-cloudflare-config-"));
  try {
    fs.writeFileSync(path.join(fixtureRoot, "wrangler.toml"), "# fixture\n");
    const output = runFailure(checker, {
      CLOUDFLARE_CONFIG_MODE: "fixture",
      CLOUDFLARE_CONFIG_ROOT: fixtureRoot,
    });
    assert.match(output, /workers\/fast-jobs\/wrangler\.toml: required Cloudflare configuration file is missing/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Pages output check rejects Cloudflare ID files without logging IDs", () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-pages-output-"));
  try {
    fs.mkdirSync(path.join(outputRoot, "_next", "static"), { recursive: true });
    fs.mkdirSync(path.join(outputRoot, "cloudflare"), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, "_worker.js"), "export default {};\n");
    fs.writeFileSync(path.join(outputRoot, "_routes.json"), JSON.stringify({ version: 1, include: ["/*"], exclude: ["/_next/static/*"] }));
    fs.writeFileSync(path.join(outputRoot, "cloudflare", "ids.json"), JSON.stringify({ d1_database_id: "secret-real-id" }));
    const output = runFailure(pagesChecker, { PAGES_OUTPUT_DIR: outputRoot });
    assert.match(output, /cloudflare\/ids\.json/);
    assert.match(output, /remove this file from the Pages artifact/);
    assert.doesNotMatch(output, /secret-real-id/);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
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
  assert.match(workflow, /--retry-max-time 30/);
  assert.match(workflow, /api\/health/);
  assert.match(workflow, /_next\/static/);
  assert.match(workflow, /api\/auth\/callback\/discord/);
  assert.match(workflow, /FAST_JOBS_URL/);
  assert.match(workflow, /CONTENT_JOBS_URL/);
  assert.match(workflow, /SYNC_JOBS_URL/);
  assert.match(workflow, /expected 401, 404, or 405/);
});

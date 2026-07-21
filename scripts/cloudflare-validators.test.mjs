import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BOOTSTRAP_STEPS, bootstrapCloudflareResources } from "./cloudflare-bootstrap.mjs";
import { checkCloudflareConfig } from "./check-cloudflare-config.mjs";
import { checkCloudflareTemplate } from "./check-cloudflare-template.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-validator-"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function cronWorker(name, { r2 = false, cron = "*/5 * * * *" } = {}) {
  return [
    `name = "flamenode-${name}"`,
    'main = "index.ts"',
    'compatibility_date = "2026-07-21"',
    'compatibility_flags = ["nodejs_compat"]',
    "",
    "[triggers]",
    `crons = ["${cron}"]`,
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "flamenode_db"',
    'database_id = "00000000-0000-0000-0000-000000000000"',
    ...(r2 ? ["", "[[r2_buckets]]", 'binding = "R2"', 'bucket_name = "flamenode-storage"'] : []),
    "",
    "[[kv_namespaces]]",
    'binding = "KV"',
    'id = "00000000000000000000000000000000"',
    "",
  ].join("\n");
}

function writeValidTemplate(root) {
  write(
    root,
    "package.json",
    JSON.stringify({
      engines: { node: ">=22 <23" },
      scripts: { "workers:build": "opennextjs-cloudflare build" },
      dependencies: { "@opennextjs/cloudflare": "1.20.1" },
    }),
  );
  write(root, ".nvmrc", "22\n");
  write(
    root,
    "cloudflare/ids.example.json",
    JSON.stringify({
      NODE_VERSION: "22",
      SKIP_DEPENDENCY_INSTALL: "true",
      CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
      CF_D1_DATABASE_ID: "00000000-0000-0000-0000-000000000000",
      CF_KV_NAMESPACE_ID: "0".repeat(32),
      CF_R2_BUCKET_NAME: "flamenode-storage",
    }),
  );
  write(
    root,
    "open-next.config.ts",
    'import { defineCloudflareConfig } from "@opennextjs/cloudflare";\nexport default defineCloudflareConfig();\n',
  );
  write(
    root,
    "wrangler.toml",
    [
      'name = "flamenode-web"',
      'main = ".open-next/worker.js"',
      'compatibility_date = "2026-07-21"',
      'compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]',
      "",
      "[assets]",
      'directory = ".open-next/assets"',
      'binding = "ASSETS"',
      "run_worker_first = false",
      "",
      "[[services]]",
      'binding = "WORKER_SELF_REFERENCE"',
      'service = "flamenode-web"',
      "",
      "[[d1_databases]]",
      'binding = "DB"',
      'database_name = "flamenode_db"',
      'database_id = "00000000-0000-0000-0000-000000000000"',
      "",
      "[[r2_buckets]]",
      'binding = "BUCKET"',
      'bucket_name = "flamenode-storage"',
      "",
      "[[r2_buckets]]",
      'binding = "NEXT_INC_CACHE_R2_BUCKET"',
      'bucket_name = "flamenode-storage"',
      "",
      "[[kv_namespaces]]",
      'binding = "KV"',
      'id = "00000000000000000000000000000000"',
      "",
    ].join("\n"),
  );
  write(root, "workers/fast-jobs/wrangler.toml", cronWorker("fast-jobs"));
  write(root, "workers/content-jobs/wrangler.toml", cronWorker("content-jobs", { r2: true, cron: "*/15 * * * *" }));
  write(root, "workers/sync-jobs/wrangler.toml", cronWorker("sync-jobs", { cron: "7,22,37,52 * * * *" }));
}

test("OpenNext web Worker and exactly three Cron Worker templates pass", () =>
  withFixture((root) => {
    writeValidTemplate(root);
    assert.deepEqual(checkCloudflareTemplate({ root }), []);
  }));

test("tracked production ID, Pages script, and multiple cron expressions fail closed", () =>
  withFixture((root) => {
    writeValidTemplate(root);
    write(
      root,
      "wrangler.toml",
      fs
        .readFileSync(path.join(root, "wrangler.toml"), "utf8")
        .replace("00000000-0000-0000-0000-000000000000", "12345678-1234-4234-9234-123456789abc"),
    );
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    packageJson.scripts["pages:deploy"] = "wrangler pages deploy .vercel/output/static";
    write(root, "package.json", JSON.stringify(packageJson));
    write(
      root,
      "workers/fast-jobs/wrangler.toml",
      cronWorker("fast-jobs").replace('crons = ["*/5 * * * *"]', 'crons = ["*/5 * * * *", "0 * * * *"]'),
    );
    const errors = checkCloudflareTemplate({ root }).join("\n");
    assert.match(errors, /tracked database_id must remain the zero placeholder/);
    assert.match(errors, /legacy pages:\* scripts|legacy Pages build or deploy/);
    assert.match(errors, /exactly one valid cron expression/);
  }));

test("production IDs in nested reference TOML files fail closed", () =>
  withFixture((root) => {
    writeValidTemplate(root);
    write(
      root,
      "design/reference/wrangler.toml",
      [
        "[[d1_databases]]",
        'database_id = "12345678-1234-4234-9234-123456789abc"',
        "",
        "[[kv_namespaces]]",
        'id = "abcdef0123456789abcdef0123456789"',
        "",
      ].join("\n"),
    );
    const errors = checkCloudflareTemplate({ root }).join("\n");
    assert.match(errors, /design\/reference\/wrangler\.toml: tracked database_id/);
    assert.match(errors, /design\/reference\/wrangler\.toml: tracked id/);
  }));

test("production config validation redacts values and rejects retired ID inputs", () =>
  withFixture((root) => {
    writeValidTemplate(root);
    const secret = "DO_NOT_PRINT_THIS_PRODUCTION_VALUE";
    const errors = checkCloudflareConfig({
      root,
      env: { AUTH_SECRET: secret, CF_IDS_JSON: '{"legacy":"value"}' },
      verify: () => {
        throw new Error(`AUTH_SECRET is invalid: ${secret}`);
      },
    }).join("\n");
    assert.match(errors, /CF_IDS_JSON is retired/);
    assert.match(errors, /\[REDACTED\]/);
    assert.doesNotMatch(errors, new RegExp(secret));
  }));

test("bootstrap only plans D1, R2, and KV and never includes Pages/deploy/migration", () => {
  const plan = JSON.stringify(BOOTSTRAP_STEPS);
  assert.equal(BOOTSTRAP_STEPS.length, 3);
  assert.doesNotMatch(plan, /pages|deploy|migration|preview/i);
  const calls = [];
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    bootstrapCloudflareResources({ root: sourceRoot, run: (request) => calls.push(request.args) });
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(calls[0], ["whoami"]);
  assert.deepEqual(calls.slice(1), BOOTSTRAP_STEPS.map((step) => [...step.args]));
});

test("tracked TOMLを書き換える旧ID同期scriptは存在しない", () => {
  assert.equal(
    fs.existsSync(path.join(sourceRoot, "scripts", "sync-wrangler-ids.mjs")),
    false,
  );
});

test("ID example contains only zero placeholders and Workers Builds variable names", () => {
  const example = JSON.parse(fs.readFileSync(path.join(sourceRoot, "cloudflare", "ids.example.json"), "utf8"));
  assert.equal(example.NODE_VERSION, "22");
  assert.equal(example.SKIP_DEPENDENCY_INSTALL, "true");
  assert.equal(example.CLOUDFLARE_ACCOUNT_ID, "0".repeat(32));
  assert.equal(example.CF_D1_DATABASE_ID, "00000000-0000-0000-0000-000000000000");
  assert.equal(example.CF_KV_NAMESPACE_ID, "0".repeat(32));
  assert.equal(Object.hasOwn(example, "pages_project_name"), false);
});

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

async function readWorkersSources() {
  const workersDir = path.join(root, "workers");
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      // Execution/contract fixtures may create in-memory SQLite tables; they
      // are not deployed Worker source and must not trip the runtime-DDL
      // guard. Only production source files participate in this check.
      else if (/\.(ts|mjs|js)$/.test(entry.name) && !/\.test\.(ts|mjs|js)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  await walk(workersDir);
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

test("package.json は互換ラッパー経由で D1 migration を適用する", async () => {
  const pkgSource = await readFile(path.join(root, "package.json"), "utf8");
  const pkg = JSON.parse(pkgSource);
  const wrapper = await readFile(
    path.join(root, "scripts/apply-d1-migrations.mjs"),
    "utf8",
  );

  assert.doesNotMatch(pkgSource, /drizzle-kit push|drizzle push/);
  assert.equal(
    pkg.scripts["db:local-apply"],
    "node scripts/apply-d1-migrations.mjs local",
  );
  assert.equal(
    pkg.scripts["db:remote-apply"],
    "node scripts/apply-d1-migrations.mjs remote",
  );
  assert.match(wrapper, /materializeD1CompatibleMigrations/);
  assert.match(wrapper, /"d1",\s*\n\s*"migrations",\s*\n\s*"apply"/);
});

test("instrumentation は schema version を読むだけで migration しない", async () => {
  const instrumentation = await readFile(
    path.join(root, "instrumentation.ts"),
    "utf8",
  );
  assert.match(instrumentation, /SELECT version FROM flamenode_schema_meta/);
  assert.doesNotMatch(instrumentation, /ALTER\s+TABLE|CREATE\s+TABLE|migrations apply/i);
});

test("deep health は read-only schema 検査のみ", async () => {
  const deepHealth = await readFile(
    path.join(root, "src/lib/health/deepHealth.ts"),
    "utf8",
  );
  assert.match(deepHealth, /sqlite_master/);
  assert.doesNotMatch(deepHealth, /ALTER\s+TABLE|CREATE\s+TABLE|migrations apply/i);
});

test("定期 Worker に runtime migration 経路がない", async () => {
  const sources = await readWorkersSources();
  for (const source of sources) {
    assert.doesNotMatch(source, /ALTER\s+TABLE|CREATE\s+TABLE/i);
    assert.doesNotMatch(source, /d1 migrations apply|drizzle-kit push/i);
  }
});

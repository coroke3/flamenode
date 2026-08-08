import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyAutoDeployMigration,
  parseAppliedMigrationNames,
  pendingMigrationNames,
  runSafeRemoteIndexMigrations,
} from "./safe-d1-auto-migrate.mjs";

const root = path.resolve(import.meta.dirname, "..");

function withTempDirectory(prefix, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function writeMigration(repoRoot, name, body) {
  const migrationsDir = path.join(repoRoot, "migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(path.join(migrationsDir, name), body, "utf8");
}

const safeIndexMigration = `-- Migration: 0001_safe.sql
-- Date: 2026-08-09
-- Type: additive
-- Summary: fixture
-- Data loss: none
-- Rollback: DROP INDEX IF EXISTS fixture_idx
-- Change log: docs/database/change-log.md

CREATE INDEX IF NOT EXISTS fixture_idx
  ON fixture(value)
  WHERE value IS NOT NULL;
`;

test("safe auto-deploy policy accepts only idempotent additive no-data-loss index migrations", () => {
  assert.deepEqual(classifyAutoDeployMigration(safeIndexMigration), {
    safe: true,
    reason: null,
  });
  assert.equal(
    classifyAutoDeployMigration(
      safeIndexMigration.replace("Type: additive", "Type: destructive"),
    ).safe,
    false,
  );
  assert.equal(
    classifyAutoDeployMigration(
      safeIndexMigration.replace("Data loss: none", "Data loss: possible"),
    ).safe,
    false,
  );
  assert.equal(
    classifyAutoDeployMigration(
      safeIndexMigration.replace(
        "CREATE INDEX IF NOT EXISTS fixture_idx\n  ON fixture(value)\n  WHERE value IS NOT NULL;",
        "ALTER TABLE fixture ADD COLUMN extra TEXT;",
      ),
    ).safe,
    false,
  );
  assert.equal(
    classifyAutoDeployMigration(
      safeIndexMigration.replace("CREATE INDEX IF NOT EXISTS", "CREATE INDEX"),
    ).safe,
    false,
  );
});

test("0054 media reference indexes are eligible for the guarded production auto-apply path", () => {
  const body = fs.readFileSync(
    path.join(root, "migrations", "0054_media_reference_read_indexes.sql"),
    "utf8",
  );
  assert.deepEqual(classifyAutoDeployMigration(body), {
    safe: true,
    reason: null,
  });
});

test("migration probe payload normalization ignores sql suffix differences", () => {
  const applied = parseAppliedMigrationNames([
    {
      success: true,
      results: [
        {
          migration_names: "0000_base.sql\u001f0001_next",
        },
      ],
    },
  ]);
  assert.deepEqual([...applied], ["0000_base", "0001_next"]);
  assert.deepEqual(
    pendingMigrationNames(["0000_base.sql", "0001_next.sql", "0002_last.sql"], applied),
    ["0002_last.sql"],
  );
});

test("safe pending index migrations apply once and are verified again before deploy", () =>
  withTempDirectory("flamenode-safe-d1-", (repoRoot) => {
    writeMigration(repoRoot, "0000_base.sql", safeIndexMigration.replaceAll("0001_safe", "0000_base"));
    writeMigration(repoRoot, "0001_safe.sql", safeIndexMigration);
    const appliedSnapshots = [new Set(["0000_base"]), new Set(["0000_base", "0001_safe"])];
    const calls = [];
    const result = runSafeRemoteIndexMigrations({
      env: { CLOUDFLARE_API_TOKEN: "fixture-token" },
      repoRoot,
      webConfig: path.join(repoRoot, "web.toml"),
      wranglerBin: path.join(repoRoot, "wrangler.mjs"),
      readApplied: () => appliedSnapshots.shift(),
      run: (request) => {
        calls.push(request);
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.applied, true);
    assert.deepEqual(result.appliedNames, ["0001_safe.sql"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].label, "cloudflare-deploy:d1-safe-index-migrations");
    assert.deepEqual(calls[0].args.slice(-4), [
      "remote",
      "--config",
      path.join(repoRoot, "web.toml"),
      "--yes",
    ]);
  }));

test("unsafe pending migrations fail closed before any D1 write", () =>
  withTempDirectory("flamenode-unsafe-d1-", (repoRoot) => {
    writeMigration(
      repoRoot,
      "0000_unsafe.sql",
      safeIndexMigration
        .replaceAll("0001_safe", "0000_unsafe")
        .replace(
          "CREATE INDEX IF NOT EXISTS fixture_idx\n  ON fixture(value)\n  WHERE value IS NOT NULL;",
          "ALTER TABLE fixture ADD COLUMN extra TEXT;",
        ),
    );
    const calls = [];
    assert.throws(
      () =>
        runSafeRemoteIndexMigrations({
          repoRoot,
          webConfig: "web.toml",
          wranglerBin: "wrangler.mjs",
          readApplied: () => new Set(),
          run: (request) => calls.push(request),
        }),
      /require manual review.*0000_unsafe\.sql/s,
    );
    assert.equal(calls.length, 0);
  }));

test("missing migration tree stays a no-op for injected deploy fixtures", () =>
  withTempDirectory("flamenode-no-migrations-", (repoRoot) => {
    const result = runSafeRemoteIndexMigrations({
      repoRoot,
      readApplied: () => {
        throw new Error("must not run");
      },
    });
    assert.deepEqual(result, { applied: false, pending: [], appliedNames: [] });
  }));

#!/usr/bin/env node

/**
 * Production D1 bootstrap / initialized 状態検査。
 * --remote は wrangler d1 execute 経由。ローカル fixture は --database で指定する。
 */
import { execSync } from "node:child_process";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

const expectEmpty = hasFlag("--expect-empty");
const expectInitialized = hasFlag("--expect-initialized");
const remote = hasFlag("--remote");

if (expectEmpty === expectInitialized) {
  console.error("Specify exactly one of --expect-empty or --expect-initialized.");
  process.exit(2);
}

const sql = `
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations') AS user_tables,
  (SELECT COUNT(*) FROM d1_migrations) AS migration_rows
`;

function runRemote() {
  const output = execSync(
    `npx wrangler d1 execute flamenode_db --remote --json --command ${JSON.stringify(sql)}`,
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  const row = parsed?.[0]?.results?.[0] ?? parsed?.results?.[0] ?? null;
  if (!row) throw new Error("Unexpected wrangler d1 execute output.");
  return {
    userTables: Number(row.user_tables ?? 0),
    migrationRows: Number(row.migration_rows ?? 0),
  };
}

function runLocal(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare(sql).get();
    return {
      userTables: Number(row?.user_tables ?? 0),
      migrationRows: Number(row?.migration_rows ?? 0),
    };
  } finally {
    db.close();
  }
}

const databasePath = argValue("--database");
let state;
try {
  if (remote) {
    state = runRemote();
  } else if (!databasePath) {
    throw new Error("--database is required unless --remote is set.");
  } else {
    state = runLocal(databasePath);
  }
} catch (error) {
  console.error(
    `[check-d1-bootstrap-state] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(2);
}

if (expectEmpty) {
  if (state.userTables > 0 || state.migrationRows > 0) {
    console.error(
      `[check-d1-bootstrap-state] D1 is not empty (tables=${state.userTables}, migrations=${state.migrationRows}).`,
    );
    process.exit(1);
  }
  console.log("[check-d1-bootstrap-state] OK: empty");
  process.exit(0);
}

if (state.migrationRows < 1 || state.userTables < 1) {
  console.error(
    `[check-d1-bootstrap-state] D1 is not initialized (tables=${state.userTables}, migrations=${state.migrationRows}).`,
  );
  process.exit(1);
}

console.log("[check-d1-bootstrap-state] OK: initialized");

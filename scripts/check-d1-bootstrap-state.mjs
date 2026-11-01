#!/usr/bin/env node

/**
 * Read-only D1 bootstrap state preflight for local SQLite and remote Wrangler.
 * An untouched database may not contain d1_migrations yet.
 * --expect-empty accepts a d1_migrations table with zero rows (created by a
 * wrangler apply that recorded nothing) but rejects any migration row.
 * Reserved prefixes (sqlite_, _cf_) are matched literally with substr():
 * LIKE treats _ as a wildcard. "user_tables" counts every user schema object
 * (tables, views, triggers, indexes), so a views-only DB is not empty.
 */
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import {
  assertRemoteD1Configured,
  runRemoteD1Command,
} from "./remote-d1-utils.mjs";

const SCRIPT = "check-d1-bootstrap-state";
const TABLES_SQL = `
SELECT
  (SELECT COUNT(*) FROM sqlite_master
   WHERE type IN ('table','view','trigger','index')
     AND substr(name, 1, 7) <> 'sqlite_'
     AND substr(name, 1, 4) <> '_cf_'
     AND substr(tbl_name, 1, 4) <> '_cf_'
     AND name <> 'd1_migrations' AND tbl_name <> 'd1_migrations') AS user_tables,
  (SELECT COUNT(*) FROM sqlite_master
   WHERE type='table' AND name='d1_migrations') AS has_migrations
`;
const MIGRATIONS_SQL = "SELECT COUNT(*) AS migration_rows FROM d1_migrations";

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

function count(row, key) {
  const raw = row?.[key];
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    throw new Error(`Missing ${key} in D1 result.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${key} in D1 result.`);
  }
  return value;
}

function inspectState(execute) {
  const row = execute(TABLES_SQL);
  const userTables = count(row, "user_tables");
  const hasMigrations = count(row, "has_migrations");
  if (hasMigrations > 1) {
    throw new Error("Invalid d1_migrations table count.");
  }
  // SQLite parses a table reference even inside an unselected CASE branch.
  // Query migration rows only when the table has actually been created.
  const migrationRows = hasMigrations
    ? count(execute(MIGRATIONS_SQL), "migration_rows")
    : 0;
  return { userTables, migrationRows };
}

function runRemote() {
  assertRemoteD1Configured(SCRIPT);
  return inspectState((sql) => {
    const rows = runRemoteD1Command(sql, { scriptName: SCRIPT });
    if (rows.length !== 1) {
      throw new Error("Unexpected wrangler D1 result row count.");
    }
    return rows[0];
  });
}

function runLocal(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return inspectState((sql) => db.prepare(sql).get());
  } finally {
    db.close();
  }
}

function main() {
  const expectEmpty = process.argv.includes("--expect-empty");
  const expectInitialized = process.argv.includes("--expect-initialized");
  const remote = process.argv.includes("--remote");
  if (expectEmpty === expectInitialized) {
    console.error("Specify exactly one of --expect-empty or --expect-initialized.");
    return 2;
  }
  const databasePath = argValue("--database");
  if (remote && databasePath) {
    console.error("--database and --remote cannot be used together.");
    return 2;
  }

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
    console.error(`[${SCRIPT}] ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (expectEmpty) {
    if (state.userTables > 0 || state.migrationRows > 0) {
      console.error(`[${SCRIPT}] D1 is not empty (tables=${state.userTables}, migrations=${state.migrationRows}).`);
      return 1;
    }
    console.log(`[${SCRIPT}] OK: empty`);
    return 0;
  }

  if (state.migrationRows < 1 || state.userTables < 1) {
    console.error(`[${SCRIPT}] D1 is not initialized (tables=${state.userTables}, migrations=${state.migrationRows}).`);
    return 1;
  }
  console.log(`[${SCRIPT}] OK: initialized`);
  return 0;
}

process.exitCode = main();

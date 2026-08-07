#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { resolveDatabasePath } from "./check-event-owners.mjs";

const root = process.cwd();
const sqlPath = path.join(root, "scripts/sql/check-auth-orphan-users.sql");
const query = fs.readFileSync(sqlPath, "utf8");
const MAX_ROWS = 20;

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

function run(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare(query).all();
  } finally {
    db.close();
  }
}

function main() {
  try {
    if (process.argv.includes("--remote")) {
      console.error(
        "[check:auth-orphan-users] --remote is not supported. Use wrangler d1 execute for remote inspection.",
      );
      process.exit(2);
    }

    const explicit =
      argValue("--database") ??
      process.env.FLAMENODE_AUTH_ORPHAN_CHECK_DB ??
      null;

    const databasePath = resolveDatabasePath({ explicit });

    if (!databasePath) {
      console.error(
        "[check:auth-orphan-users] local D1 database could not be resolved. Use --database=<path>.",
      );
      console.error(
        "[check:auth-orphan-users] Remote D1: wrangler d1 execute <database> --file=scripts/sql/check-auth-orphan-users.sql",
      );
      process.exit(2);
    }

    if (!fs.existsSync(databasePath)) {
      console.error(
        `[check:auth-orphan-users] database does not exist: ${databasePath}`,
      );
      process.exit(2);
    }

    const orphans = run(databasePath);
    console.log(`[check:auth-orphan-users] count=${orphans.length}`);

    if (orphans.length === 0) {
      console.log(
        "[check:auth-orphan-users] OK: no users without a Discord account row.",
      );
      process.exit(0);
    }

    const shown = orphans.slice(0, MAX_ROWS);
    for (const row of shown) {
      console.log(JSON.stringify(row));
    }
    if (orphans.length > MAX_ROWS) {
      console.log(
        `[check:auth-orphan-users] ... ${orphans.length - MAX_ROWS} more row(s) omitted`,
      );
    }
    console.log(
      "[check:auth-orphan-users] informational only; orphans may exist historically.",
    );
    process.exit(0);
  } catch (error) {
    console.error(
      `[check:auth-orphan-users] ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(2);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}

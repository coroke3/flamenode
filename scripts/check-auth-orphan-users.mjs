#!/usr/bin/env node

import { execSync } from "node:child_process";
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

function runLocal(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare(query).all();
  } finally {
    db.close();
  }
}

function runRemote() {
  const output = execSync(
    `npx wrangler d1 execute flamenode_db --remote --json --file=${sqlPath}`,
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  const results = parsed?.[0]?.results ?? parsed?.results ?? null;
  if (!Array.isArray(results)) {
    throw new Error("Unexpected wrangler d1 execute output.");
  }
  return results;
}

function printOrphans(orphans) {
  console.log(`[check:auth-orphan-users] count=${orphans.length}`);

  if (orphans.length === 0) {
    console.log(
      "[check:auth-orphan-users] OK: no users without a Discord account row.",
    );
    return;
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
}

function main() {
  try {
    if (process.argv.includes("--remote")) {
      const orphans = runRemote();
      printOrphans(orphans);
      process.exit(0);
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
        "[check:auth-orphan-users] Remote D1: npx wrangler d1 execute flamenode_db --remote --file=scripts/sql/check-auth-orphan-users.sql",
      );
      process.exit(2);
    }

    if (!fs.existsSync(databasePath)) {
      console.error(
        `[check:auth-orphan-users] database does not exist: ${databasePath}`,
      );
      process.exit(2);
    }

    const orphans = runLocal(databasePath);
    printOrphans(orphans);
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

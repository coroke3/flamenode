#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { resolveDatabasePath } from "./check-event-owners.mjs";

const root = process.cwd();
const sqlPath = path.join(root, "scripts/sql/check-x-link-dependencies.sql");
const query = fs.readFileSync(sqlPath, "utf8");

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
    const explicit =
      argValue("--database") ??
      process.env.FLAMENODE_X_LINK_DEPENDENCY_CHECK_DB ??
      null;
    const databasePath = resolveDatabasePath({ explicit });
    if (!databasePath) {
      console.error(
        "[check:x-link-dependencies] local D1 database could not be resolved. Use --database=<path>.",
      );
      process.exit(2);
    }
    if (!fs.existsSync(databasePath)) {
      console.error(
        `[check:x-link-dependencies] database does not exist: ${databasePath}`,
      );
      process.exit(2);
    }

    const issues = run(databasePath);
    if (issues.length === 0) {
      console.log("[check:x-link-dependencies] OK: no risky sole account links.");
      process.exit(0);
    }

    for (const issue of issues) {
      console.error(JSON.stringify(issue));
    }
    console.error(`[check:x-link-dependencies] ${issues.length} issue(s) found.`);
    process.exit(1);
  } catch (error) {
    console.error(
      `[check:x-link-dependencies] ${
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

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { REQUIRED_SCHEMA_VERSION } from "./cloudflare-production.mjs";

const root = process.cwd();
const sqlPath = path.join(
  root,
  "scripts/sql/check-event-owners.sql",
);
const query = fs.readFileSync(sqlPath, "utf8");

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) =>
    arg.startsWith(prefix),
  );
  return value?.slice(prefix.length) ?? null;
}

export function findLocalD1Database(rootDir = path.join(
  root,
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
)) {

  if (!fs.existsSync(rootDir)) return null;

  const files = fs
    .readdirSync(rootDir)
    .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
    .map((name) => path.join(rootDir, name));

  const matching = [];
  for (const databasePath of files) {
    let db;
    try {
      db = new DatabaseSync(databasePath, { readOnly: true });
      const version = db
        .prepare(
          "SELECT version FROM flamenode_schema_meta WHERE id = 'current' LIMIT 1",
        )
        .get()?.version;
      if (version === REQUIRED_SCHEMA_VERSION) matching.push(databasePath);
    } catch {
      // Empty, legacy, and invalid SQLite files are not candidates.
    } finally {
      db?.close();
    }
  }

  return matching.length === 1 ? matching[0] : null;
}

export function resolveDatabasePath({ explicit, rootDir } = {}) {
  return explicit ?? findLocalD1Database(rootDir);
}

function run(databasePath) {
  const db = new DatabaseSync(databasePath, {
    readOnly: true,
  });

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
    process.env.FLAMENODE_OWNER_CHECK_DB ??
    null;

  const databasePath = resolveDatabasePath({ explicit });

  if (!databasePath) {
    console.error(
      "[check:event-owners] local D1 database could not be resolved. Use --database=<path>.",
    );
    process.exit(2);
  }

  if (!fs.existsSync(databasePath)) {
    console.error(
      `[check:event-owners] database does not exist: ${databasePath}`,
    );
    process.exit(2);
  }

  const issues = run(databasePath);

  if (issues.length === 0) {
    console.log(
      "[check:event-owners] OK: no owner or event_staff integrity issues.",
    );
    process.exit(0);
  }

  for (const issue of issues) {
    console.error(
      JSON.stringify({
        problem_type: issue.problem_type,
        event_id: issue.event_id,
        event_title: issue.event_title,
        staff_id: issue.staff_id,
        x_user_id: issue.x_user_id,
      }),
    );
  }

  console.error(
    `[check:event-owners] ${issues.length} issue(s) found.`,
  );
  process.exit(1);
} catch (error) {
  console.error(
    `[check:event-owners] ${
      error instanceof Error
        ? error.message
        : String(error)
    }`,
  );
  process.exit(2);
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}

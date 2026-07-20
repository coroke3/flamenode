#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

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

function findLocalD1Database() {
  const rootDir = path.join(
    root,
    ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
  );

  if (!fs.existsSync(rootDir)) return null;

  const files = fs
    .readdirSync(rootDir)
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => path.join(rootDir, name));

  return files.length === 1 ? files[0] : null;
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

try {
  const explicit =
    argValue("--database") ??
    process.env.FLAMENODE_OWNER_CHECK_DB ??
    null;

  const databasePath =
    explicit ?? findLocalD1Database();

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

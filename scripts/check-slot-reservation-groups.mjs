#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { findLocalD1Database } from "./check-event-owners.mjs";
import {
  assertRemoteD1Configured,
  formatCommandFailure,
  runRemoteD1File,
} from "./remote-d1-utils.mjs";
import { collectSlotReservationAmbiguities } from "../src/lib/slot/reservationGroupsCore.ts";

const root = process.cwd();
const sqlPath = path.join(root, "scripts/sql/check-slot-reservation-groups.sql");

const migration = fs.readFileSync(
  path.join(root, "migrations/0051_slot_reservation_groups_expand.sql"),
  "utf8",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS slot_reservation_groups/);
assert.match(migration, /reserved_by_auth_user_id/);

const schema = fs.readFileSync(
  path.join(root, "src/lib/db/schema.canonical.ts"),
  "utf8",
);
assert.match(schema, /slotReservationGroups/);
assert.match(schema, /slot_reservation_groups/);

const slotAdmin = fs.readFileSync(
  path.join(root, "src/lib/actions/slot-admin.ts"),
  "utf8",
);
assert.match(slotAdmin, /includeQueue: true/);
assert.doesNotMatch(
  slotAdmin,
  /includeQueue: index === chunks\.length - 1/,
);

const pending = fs.readFileSync(
  path.join(root, "docs/database/pending/slot-reservation-groups-contract.sql"),
  "utf8",
);
assert.match(pending, /slot reservation groups/i);

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

function listAmbiguities(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'slot_reservation_groups' LIMIT 1",
      )
      .get();
    if (!tableExists) {
      return { skipped: true, issues: [] };
    }
    const rows = db.prepare(fs.readFileSync(sqlPath, "utf8")).all();
    return {
      skipped: false,
      issues: collectSlotReservationAmbiguities(rows),
    };
  } finally {
    db.close();
  }
}

function printIssues(issues, { informational }) {
  console.log(`[check:slot-reservation-groups] count=${issues.length}`);
  if (issues.length === 0) {
    console.log("check:slot-reservation-groups OK");
    return informational ? 0 : 0;
  }
  for (const issue of issues) {
    console.error(JSON.stringify(issue));
  }
  console.error(
    `[check:slot-reservation-groups] ${issues.length} ambiguous row group(s) found.`,
  );
  if (informational) {
    console.log("[check:slot-reservation-groups] informational only.");
    return 0;
  }
  return 1;
}

function main() {
  try {
    const strict = process.argv.includes("--strict");

    if (process.argv.includes("--remote")) {
      assertRemoteD1Configured("check:slot-reservation-groups");
      const rows = runRemoteD1File(sqlPath, {
        scriptName: "check:slot-reservation-groups",
      });
      const issues = collectSlotReservationAmbiguities(rows);
      process.exit(printIssues(issues, { informational: !strict }));
    }

    const explicit =
      argValue("--database") ?? process.env.FLAMENODE_SLOT_GROUP_CHECK_DB ?? null;
    const databasePath = explicit ?? findLocalD1Database();
    if (!databasePath) {
      if (strict) {
        console.error(
          "[check:slot-reservation-groups] --strict requires a local D1 database.",
        );
        process.exit(2);
      }
      console.log(
        "check:slot-reservation-groups OK (static checks only; no local D1)",
      );
      process.exit(0);
    }
    const result = listAmbiguities(databasePath);
    if (result.skipped) {
      console.log(
        "check:slot-reservation-groups OK (migration not applied in local D1)",
      );
      process.exit(0);
    }
    process.exit(printIssues(result.issues, { informational: !strict }));
  } catch (error) {
    console.error(
      `[check:slot-reservation-groups] ${
        error instanceof Error && !error.status
          ? error.message
          : formatCommandFailure(error)
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

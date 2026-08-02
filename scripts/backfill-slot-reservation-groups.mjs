#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { findLocalD1Database } from "./check-event-owners.mjs";
import { buildSlotReservationGroupCandidates } from "../src/lib/slot/reservationGroupsCore.ts";

const root = process.cwd();

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const explicit =
    argValue("--database") ?? process.env.FLAMENODE_SLOT_GROUP_BACKFILL_DB ?? null;
  const databasePath = explicit ?? findLocalD1Database();
  if (!databasePath) {
    console.error(
      "[backfill-slot-reservation-groups] local D1 database could not be resolved. Use --database=<path>.",
    );
    process.exit(2);
  }

  const db = new DatabaseSync(databasePath);
  try {
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'slot_reservation_groups' LIMIT 1",
      )
      .get();
    if (!tableExists) {
      console.error(
        "[backfill-slot-reservation-groups] slot_reservation_groups table is missing. Apply migration 0051 first.",
      );
      process.exit(2);
    }

    const rows = db
      .prepare(
        `SELECT id, event_id, reservation_group_id, reserved_by_user_id,
                x_user_id, display_name, status, video_id
         FROM slots
         WHERE reservation_group_id IS NOT NULL`,
      )
      .all();
    const { candidates, ambiguities } = buildSlotReservationGroupCandidates(rows);
    if (ambiguities.length > 0) {
      for (const issue of ambiguities) {
        console.error(JSON.stringify({ ambiguous: issue }));
      }
      console.error(
        `[backfill-slot-reservation-groups] ${ambiguities.length} ambiguous group(s); fix manually before backfill.`,
      );
      process.exit(1);
    }

    const now = Math.floor(Date.now() / 1000);
    let inserted = 0;
    let skipped = 0;
    const insert = db.prepare(
      `INSERT OR IGNORE INTO slot_reservation_groups
        (id, event_id, reserved_by_auth_user_id, x_user_id, display_name, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    );

    if (!dryRun) {
      const tx = db.transaction((items) => {
        for (const candidate of items) {
          const result = insert.run(
            candidate.groupId,
            candidate.eventId,
            candidate.reservedByAuthUserId,
            candidate.xUserId,
            candidate.displayName,
            now,
            now,
          );
          if (result.changes > 0) inserted += 1;
          else skipped += 1;
        }
      });
      tx(candidates);
    }

    console.log(
      JSON.stringify({
        dryRun,
        candidateCount: candidates.length,
        inserted,
        skipped,
      }),
    );
    process.exit(0);
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}

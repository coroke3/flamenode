#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { findLocalD1Database } from "./check-event-owners.mjs";

const root = process.cwd();

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

function checkDatabase(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'video_moderation_cases' LIMIT 1")
      .get();
    if (!table) return;
    const duplicates = db
      .prepare(
        `SELECT video_id, case_type, COUNT(*) AS open_count
           FROM video_moderation_cases
          WHERE status = 'open'
          GROUP BY video_id, case_type
         HAVING COUNT(*) > 1
          ORDER BY video_id, case_type`,
      )
      .all();
    if (duplicates.length > 0) {
      for (const row of duplicates) console.error(JSON.stringify({ duplicate_open_case: row }));
      throw new Error(`duplicate open moderation cases: ${duplicates.length}`);
    }
  } finally {
    db.close();
  }
}

const pending = readFileSync(
  path.join(root, "docs/database/pending/video-moderation-open-unique.sql"),
  "utf8",
);
assert.match(pending, /video_moderation_cases_open_unique_idx/);
assert.match(pending, /WHERE status = 'open'/);

const moderationAdmin = readFileSync(
  path.join(root, "src/lib/actions/moderation-admin.ts"),
  "utf8",
);
assert.match(moderationAdmin, /planVideoVisibilityTransition/);
assert.match(moderationAdmin, /buildAfterVideoStatusChangeQueueBatch|planVideoVisibilityTransition/);

const transition = readFileSync(
  path.join(root, "src/lib/video/videoVisibilityTransition.ts"),
  "utf8",
);
assert.match(transition, /buildAfterVideoStatusChangeQueueBatch/);
assert.match(transition, /buildVideoStatusChangeNotificationBatch/);
assert.match(transition, /preCommitVideoVisibilityDepublicization/);

const openCases = readFileSync(
  path.join(root, "src/lib/moderation/openCases.ts"),
  "utf8",
);
assert.match(openCases, /planVoidModerationCaseOpen/);
assert.match(openCases, /planVoidModerationCaseResolve/);

const databasePath =
  argValue("--database") ?? process.env.FLAMENODE_MODERATION_CHECK_DB ?? findLocalD1Database();
if (databasePath) checkDatabase(databasePath);

console.log("check:moderation-open-cases OK");

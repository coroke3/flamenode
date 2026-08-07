#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { MAX_SLOTS_PER_VIDEO, MAX_STAGE_PERMISSION_QUESTIONS } from "../src/lib/event/eventLimits.ts";
import { collectSlotReservationAmbiguities } from "../src/lib/slot/reservationGroupsCore.ts";
import { findLocalD1Database } from "./check-event-owners.mjs";
import {
  assertRemoteD1Configured,
  formatCommandFailure,
  runRemoteD1File,
} from "./remote-d1-utils.mjs";

const root = process.cwd();
const sqlPaths = {
  events: path.join(root, "scripts/sql/check-slot-domain-limits-events.sql"),
  groups: path.join(root, "scripts/sql/check-slot-domain-limits-groups.sql"),
  stageQuestions: path.join(
    root,
    "scripts/sql/check-slot-domain-limits-stage-questions.sql",
  ),
  slots: path.join(root, "scripts/sql/check-slot-domain-limits-slots.sql"),
};

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

function runSql(databasePath, sql) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

function collectIssuesFromRows({
  overMaxSlots,
  overGroupSize,
  overStageQuestions,
  slotRows,
}) {
  const issues = [];

  for (const row of overMaxSlots) {
    issues.push({
      kind: "event_max_slots_per_video_exceeded",
      event_id: row.id,
      max_slots_per_video: row.max_slots_per_video,
      limit: MAX_SLOTS_PER_VIDEO,
    });
  }

  for (const row of overGroupSize) {
    issues.push({
      kind: "reservation_group_size_exceeded",
      reservation_group_id: row.reservation_group_id,
      event_id: row.event_id,
      slot_count: row.slot_count,
      limit: MAX_SLOTS_PER_VIDEO,
    });
  }

  for (const row of overStageQuestions) {
    issues.push({
      kind: "stage_permission_questions_exceeded",
      event_id: row.event_id,
      question_count: row.question_count,
      limit: MAX_STAGE_PERMISSION_QUESTIONS,
    });
  }

  for (const report of collectSlotReservationAmbiguities(slotRows)) {
    issues.push({
      kind: `slot_${report.kind}`,
      slot_ids: report.slotIds,
      reservation_group_id: report.reservationGroupId ?? null,
      event_id: report.eventId ?? null,
    });
  }

  return issues;
}

function listDomainLimitIssues(databasePath) {
  const overMaxSlots = runSql(
    databasePath,
    `SELECT id, max_slots_per_video
     FROM events
     WHERE max_slots_per_video > ${MAX_SLOTS_PER_VIDEO}`,
  );
  const overGroupSize = runSql(
    databasePath,
    `SELECT reservation_group_id, event_id, COUNT(*) AS slot_count
     FROM slots
     WHERE reservation_group_id IS NOT NULL
     GROUP BY reservation_group_id, event_id
     HAVING COUNT(*) > ${MAX_SLOTS_PER_VIDEO}`,
  );
  const overStageQuestions = runSql(
    databasePath,
    `SELECT event_id, COUNT(*) AS question_count
     FROM event_custom_questions
     WHERE question_key = 'stage_permission'
        OR question_key LIKE 'stage_permission_%'
     GROUP BY event_id
     HAVING COUNT(*) > ${MAX_STAGE_PERMISSION_QUESTIONS}`,
  );
  const slotRows = runSql(databasePath, fs.readFileSync(sqlPaths.slots, "utf8"));

  return collectIssuesFromRows({
    overMaxSlots,
    overGroupSize,
    overStageQuestions,
    slotRows,
  });
}

function listRemoteIssues() {
  const overMaxSlots = runRemoteD1File(sqlPaths.events, {
    scriptName: "check:slot-domain-limits",
  });
  const overGroupSize = runRemoteD1File(sqlPaths.groups, {
    scriptName: "check:slot-domain-limits",
  });
  const overStageQuestions = runRemoteD1File(sqlPaths.stageQuestions, {
    scriptName: "check:slot-domain-limits",
  });
  const slotRows = runRemoteD1File(sqlPaths.slots, {
    scriptName: "check:slot-domain-limits",
  });

  return collectIssuesFromRows({
    overMaxSlots,
    overGroupSize,
    overStageQuestions,
    slotRows,
  });
}

function printIssues(issues, { informational }) {
  if (issues.length === 0) {
    console.log("check:slot-domain-limits OK");
    return 0;
  }
  for (const issue of issues) {
    console.error(JSON.stringify(issue));
  }
  console.error(
    `[check:slot-domain-limits] ${issues.length} domain limit issue(s) found.`,
  );
  if (informational) {
    console.log("[check:slot-domain-limits] informational only.");
    return 0;
  }
  return 1;
}

function main() {
  try {
    if (process.argv.includes("--remote")) {
      assertRemoteD1Configured("check:slot-domain-limits");
      const issues = listRemoteIssues();
      process.exit(printIssues(issues, { informational: true }));
    }

    const explicit =
      argValue("--database") ?? process.env.FLAMENODE_SLOT_DOMAIN_LIMITS_DB ?? null;
    const databasePath = explicit ?? findLocalD1Database();
    if (!databasePath) {
      console.log(
        "check:slot-domain-limits OK (static checks only; no local D1)",
      );
      process.exit(0);
    }

    if (!fs.existsSync(databasePath)) {
      console.error(
        `[check:slot-domain-limits] database does not exist: ${databasePath}`,
      );
      process.exit(2);
    }

    const issues = listDomainLimitIssues(databasePath);
    process.exit(printIssues(issues, { informational: false }));
  } catch (error) {
    console.error(
      `[check:slot-domain-limits] failed: ${formatCommandFailure(error)}`,
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

#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_SLOTS_PER_VIDEO, MAX_STAGE_PERMISSION_QUESTIONS } from "../src/lib/event/eventLimits.ts";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/check-slot-domain-limits.mjs");

test("slot-domain-limits SQL files exist and match domain constants", () => {
  const eventsSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-slot-domain-limits-events.sql"),
    "utf8",
  );
  const groupsSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-slot-domain-limits-groups.sql"),
    "utf8",
  );
  const stageSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-slot-domain-limits-stage-questions.sql"),
    "utf8",
  );
  const slotsSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-slot-domain-limits-slots.sql"),
    "utf8",
  );

  assert.match(eventsSql, new RegExp(`> ${MAX_SLOTS_PER_VIDEO}`));
  assert.match(groupsSql, new RegExp(`> ${MAX_SLOTS_PER_VIDEO}`));
  assert.match(stageSql, new RegExp(`> ${MAX_STAGE_PERMISSION_QUESTIONS}`));
  assert.match(slotsSql, /FROM slots/);
});

test("slot-domain-limits script supports remote file-based inspection", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /--remote/);
  assert.match(source, /runRemoteD1File/);
  assert.match(source, /check-slot-domain-limits-events\.sql/);
  assert.match(source, /assertRemoteD1Configured/);
  assert.match(source, /formatCommandFailure/);
  assert.match(source, /informational only/);
});

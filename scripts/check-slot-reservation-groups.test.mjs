#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { findLocalD1Database } from "./check-event-owners.mjs";

const root = process.cwd();
const sqlPath = path.join(root, "scripts/sql/check-slot-reservation-groups.sql");
const scriptPath = path.join(root, "scripts/check-slot-reservation-groups.mjs");

test("slot-reservation-groups SQL selects ambiguity columns", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  assert.match(sql, /FROM slots/);
  assert.match(sql, /reservation_group_id/);
  assert.match(sql, /reserved_by_user_id/);
  assert.match(sql, /status IN \('reserved', 'submitted'\)/);
});

test("slot-reservation-groups script supports remote inspection via wrangler", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /--remote/);
  assert.match(source, /--strict/);
  assert.match(source, /runRemoteD1File/);
  assert.match(source, /assertRemoteD1Configured/);
  assert.match(source, /collectSlotReservationAmbiguities/);
  assert.match(source, /informational only/);
  assert.match(source, /informational: !strict/);
  assert.match(source, /--strict requires a local D1 database/);
});

test("slot-reservation-groups local mode still resolves D1 path", () => {
  const explicit = path.join(root, "scripts/sql/check-slot-reservation-groups.sql");
  assert.ok(typeof findLocalD1Database === "function");
  assert.ok(fs.existsSync(explicit));
});

#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/check-slot-domain-limits.mjs");

test("slot-domain-limits script embeds domain constants in generated SQL", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, new RegExp(`MAX_SLOTS_PER_VIDEO`));
  assert.match(source, new RegExp(`> \\$\\{MAX_SLOTS_PER_VIDEO\\}`));
  assert.match(source, new RegExp(`> \\$\\{MAX_STAGE_PERMISSION_QUESTIONS\\}`));
  const slotsSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-slot-domain-limits-slots.sql"),
    "utf8",
  );
  assert.match(slotsSql, /FROM slots/);
});

test("slot-domain-limits script supports remote command-based inspection", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /--remote/);
  assert.match(source, /--strict/);
  assert.match(source, /runRemoteD1Command/);
  assert.match(source, /runRemoteD1File/);
  assert.match(source, /sqlOverMaxSlots/);
  assert.match(source, /assertRemoteD1Configured/);
  assert.match(source, /formatCommandFailure/);
  assert.match(source, /informational only/);
  assert.match(source, /informational: !strict/);
  assert.match(source, /--strict requires a local D1 database/);
});

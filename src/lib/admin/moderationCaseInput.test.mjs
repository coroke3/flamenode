import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeModerationCaseType,
  normalizeModerationResolutionStatus,
  normalizeModerationText,
  normalizeModerationVideoStatus,
  normalizeModerationXUserId,
  parseModerationDueAt,
} from "./moderationCaseInput.ts";

test("normalizeModerationCaseType accepts known case types only", () => {
  assert.equal(normalizeModerationCaseType("rights"), "rights");
  assert.equal(normalizeModerationCaseType("duplicate"), "duplicate");
  assert.equal(normalizeModerationCaseType("bad"), null);
});

test("normalizeModerationResolutionStatus accepts terminal statuses only", () => {
  assert.equal(normalizeModerationResolutionStatus("resolved"), "resolved");
  assert.equal(normalizeModerationResolutionStatus("cancelled"), "cancelled");
  assert.equal(normalizeModerationResolutionStatus("open"), null);
});

test("normalizeModerationVideoStatus treats empty as no status change", () => {
  assert.equal(normalizeModerationVideoStatus("voided"), "voided");
  assert.equal(normalizeModerationVideoStatus(""), null);
  assert.equal(normalizeModerationVideoStatus("deleted"), null);
});

test("parseModerationDueAt parses datetime-local as JST", () => {
  assert.equal(parseModerationDueAt("2026-05-30T12:00"), 1780110000);
  assert.equal(parseModerationDueAt(""), null);
  assert.equal(parseModerationDueAt("not-date"), null);
});

test("normalizeModerationText trims and clamps", () => {
  assert.equal(normalizeModerationText("  abcdef  ", 3), "abc");
});

test("normalizeModerationXUserId removes @ and lowercases", () => {
  assert.equal(normalizeModerationXUserId(" @Old_ID "), "old_id");
  assert.equal(normalizeModerationXUserId(""), null);
});

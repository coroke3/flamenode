import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeLegacyFiles as sharedNormalize,
  legacyImportAuthUserId as sharedAuthUserId,
  isLegacyImportPlaceholderAuthUserId as sharedPlaceholder,
  MAX_LEGACY_VIDEO_FIELD_DECISIONS as SHARED_DECISION_LIMIT,
} from "@flamenode/server-core/legacyImport/normalize";
import {
  normalizeLegacyFiles as currentNormalize,
  legacyImportAuthUserId as currentAuthUserId,
  isLegacyImportPlaceholderAuthUserId as currentPlaceholder,
  MAX_LEGACY_VIDEO_FIELD_DECISIONS as CURRENT_DECISION_LIMIT,
} from "../../../src/lib/import/legacy/normalize.ts";
import { parseLegacyImportText } from "@flamenode/server-core/legacyImport/parse";

test("RH-002 U02 normalization: CURRENT exports are canonical shared implementation", () => {
  assert.equal(currentNormalize, sharedNormalize);
  assert.equal(currentAuthUserId, sharedAuthUserId);
  assert.equal(currentPlaceholder, sharedPlaceholder);
  assert.equal(CURRENT_DECISION_LIMIT, SHARED_DECISION_LIMIT);
});

test("RH-002 U02 normalization: deterministic empty plan with all canonical collections", () => {
  const plan = sharedNormalize([], {
    eventVisibility: "public",
    videoVisibility: "private",
    videoFieldDecisions: [],
    now: 1700000000,
  });
  for (const field of [
    "events", "eventStaff", "xUsers", "videos", "videoEvents",
    "videoMembers", "videoChapters", "videoSoftwares", "eventCustomQuestions",
    "videoCustomAnswers", "videoFieldDecisions", "unmappedVideoFields",
    "warnings", "errors",
  ]) assert.deepEqual(plan[field], [], field);
});

test("RH-002 U02 normalization: placeholder auth identity remains deterministic", () => {
  const value = sharedAuthUserId("x-123");
  assert.equal(value, sharedAuthUserId("x-123"));
  assert.equal(sharedPlaceholder(value), true);
  assert.equal(sharedPlaceholder("user-123"), false);
  assert.notEqual(sharedAuthUserId("x-123"), sharedAuthUserId("x-456"));
});

test("RH-002 U02 normalization: parsed legacy source is accepted by canonical normalizer", () => {
  const source = parseLegacyImportText("empty-legacy.csv", "id,title\nevent-one,Event One\n");
  const plan = sharedNormalize([source], {
    eventVisibility: "private",
    videoVisibility: "private",
    now: 1700000000,
  });
  assert.equal(Array.isArray(plan.events), true);
  assert.equal(Array.isArray(plan.videos), true);
  assert.equal(Array.isArray(plan.errors), true);
  assert.equal(Array.isArray(plan.warnings), true);
});

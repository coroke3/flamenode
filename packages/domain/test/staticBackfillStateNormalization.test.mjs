import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const validRun = { cursor: "  next  ", phase: "shared_inputs", status: "running", total: 12, scanned: 5, enqueued: 3, last_error: null, last_run_at: 1700000000 };
const valid = { schema_version: 1, updated_at: 1700000000, runs: { video_v2: validRun } };

test("static backfill state preserves valid numbers and numeric strings", () => {
  const parsed = parseStaticBackfillState({ ...valid, updated_at: "1700000000", runs: { video_v2: { ...validRun, total: "12", scanned: "5", enqueued: "3", last_run_at: "1700000000" } } });
  assert.equal(parsed.updated_at, 1700000000);
  assert.equal(parsed.runs.video_v2.total, 12);
  assert.equal(parsed.runs.video_v2.scanned, 5);
  assert.equal(parsed.runs.video_v2.enqueued, 3);
  assert.equal(parsed.runs.video_v2.last_run_at, 1700000000);
  assert.equal(parsed.runs.video_v2.cursor, "next");
  assert.equal(parsed.runs.video_v2.phase, "shared_inputs");
  assert.equal(parsed.runs.video_v2.status, "running");
});

test("static backfill state rejects coerced schema and invalid envelopes", () => {
  for (const input of [null, [], true, { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(input), createEmptyStaticBackfillState());
  }
});

test("static backfill counters reject coerced values and fall back to zero", () => {
  for (const value of [true, false, [], [5], {}, " ", "", null, undefined, Infinity, "Infinity", "1e309"]) {
    const parsed = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...validRun, total: value, scanned: value, enqueued: value } } });
    assert.equal(parsed.runs.video_v2.total, 0);
    assert.equal(parsed.runs.video_v2.scanned, 0);
    assert.equal(parsed.runs.video_v2.enqueued, 0);
  }
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...validRun, total: -2.8 } } }).runs.video_v2.total, 0);
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...validRun, total: 2.8 } } }).runs.video_v2.total, 2);
});

test("static backfill timestamps reject coerced values and fall back to null", () => {
  for (const value of [true, false, [], [5], {}, " ", "", null, undefined, Infinity, "Infinity", "1e309"]) {
    const parsed = parseStaticBackfillState({ ...valid, updated_at: value, runs: { video_v2: { ...validRun, last_run_at: value } } });
    assert.equal(parsed.updated_at, null);
    assert.equal(parsed.runs.video_v2.last_run_at, null);
  }
});

test("static backfill missing runs retain idle defaults", () => {
  const parsed = parseStaticBackfillState({ schema_version: 1, runs: {} });
  assert.equal(parsed.runs.user_profile.status, "idle");
  assert.equal(parsed.runs.event_crew.total, 0);
  assert.equal(parsed.updated_at, null);
});

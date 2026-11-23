import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const run = { cursor: " cursor ", phase: "shared_inputs", status: "running", total: 12, scanned: 5, enqueued: 3, last_error: null, last_run_at: 1700000000 };
const valid = { schema_version: 1, updated_at: 1700000000, runs: { video_v2: run } };

test("backfill state accepts valid producer numbers and numeric strings", () => {
  const result = parseStaticBackfillState({ ...valid, updated_at: "1700000000", runs: { video_v2: { ...run, total: "12", scanned: "5", enqueued: "3", last_run_at: "1700000000" } } });
  assert.equal(result.updated_at, 1700000000);
  assert.equal(result.runs.video_v2.total, 12);
  assert.equal(result.runs.video_v2.scanned, 5);
  assert.equal(result.runs.video_v2.enqueued, 3);
  assert.equal(result.runs.video_v2.last_run_at, 1700000000);
  assert.equal(result.runs.video_v2.cursor, "cursor");
  assert.equal(result.runs.video_v2.phase, "shared_inputs");
});

test("backfill state rejects coerced schema and array envelopes", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(value), createEmptyStaticBackfillState());
  }
});

test("backfill state maps malformed counters to zero", () => {
  for (const count of [true, false, [], [5], {}, " ", "", null, undefined, Infinity, "Infinity", "1e309"]) {
    const result = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: count, scanned: count, enqueued: count } } });
    assert.equal(result.runs.video_v2.total, 0);
    assert.equal(result.runs.video_v2.scanned, 0);
    assert.equal(result.runs.video_v2.enqueued, 0);
  }
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: -2, scanned: 2.9 } } }).runs.video_v2.total, 0);
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, scanned: 2.9 } } }).runs.video_v2.scanned, 2);
});

test("backfill state maps malformed timestamps to null", () => {
  for (const timestamp of [true, false, [], [5], {}, " ", "", null, undefined, Infinity, "Infinity", "1e309"]) {
    const result = parseStaticBackfillState({ ...valid, updated_at: timestamp, runs: { video_v2: { ...run, last_run_at: timestamp } } });
    assert.equal(result.updated_at, null);
    assert.equal(result.runs.video_v2.last_run_at, null);
  }
});

test("backfill state retains default run values and status semantics", () => {
  const result = parseStaticBackfillState(valid);
  assert.equal(result.runs.video_v2.status, "running");
  assert.equal(result.runs.event_crew.status, "idle");
  assert.equal(result.runs.user_profile.total, 0);
});

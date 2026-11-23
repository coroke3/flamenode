import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const run = { cursor: " next ", phase: "shared_inputs", status: "running", total: 10, scanned: 5, enqueued: 3, last_error: " error ", last_run_at: 1700000000 };
const valid = { schema_version: 1, updated_at: 1700000001, runs: { video_v2: run } };

test("backfill state accepts valid numeric values and numeric strings", () => {
  const parsed = parseStaticBackfillState({ ...valid, updated_at: "1700000001", runs: { video_v2: { ...run, total: "10", scanned: "5", enqueued: "3", last_run_at: "1700000000" } } });
  assert.equal(parsed.updated_at, 1700000001);
  assert.equal(parsed.runs.video_v2.total, 10);
  assert.equal(parsed.runs.video_v2.scanned, 5);
  assert.equal(parsed.runs.video_v2.enqueued, 3);
  assert.equal(parsed.runs.video_v2.last_run_at, 1700000000);
  assert.equal(parsed.runs.video_v2.cursor, "next");
  assert.equal(parsed.runs.video_v2.phase, "shared_inputs");
});

test("backfill state rejects coerced schema and invalid envelopes", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(value), createEmptyStaticBackfillState());
  }
});

test("backfill state defaults malformed counters to zero", () => {
  for (const malformed of [true, false, [], [5], {}, " ", "", null, undefined, "Infinity", Infinity]) {
    const parsed = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: malformed, scanned: malformed, enqueued: malformed } } });
    assert.equal(parsed.runs.video_v2.total, 0);
    assert.equal(parsed.runs.video_v2.scanned, 0);
    assert.equal(parsed.runs.video_v2.enqueued, 0);
  }
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: -2.5 } } }).runs.video_v2.total, 0);
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: 3.9 } } }).runs.video_v2.total, 3);
});

test("backfill state defaults malformed timestamps to null", () => {
  for (const malformed of [true, false, [], [5], {}, " ", "", null, undefined, "Infinity", Infinity]) {
    const parsed = parseStaticBackfillState({ ...valid, updated_at: malformed, runs: { video_v2: { ...run, last_run_at: malformed } } });
    assert.equal(parsed.updated_at, null);
    assert.equal(parsed.runs.video_v2.last_run_at, null);
  }
});

test("backfill state retains missing-run and status defaults", () => {
  const parsed = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, status: "invalid", phase: "invalid" } } });
  assert.equal(parsed.runs.video_v2.status, "idle");
  assert.equal(parsed.runs.video_v2.phase, "items");
  assert.equal(parsed.runs.user_profile.status, "idle");
  assert.equal(parsed.runs.event_crew.status, "idle");
});

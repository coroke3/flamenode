import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const valid = { schema_version: 1, updated_at: 1700000000, runs: { video_v2: { status: "running", phase: "shared_inputs", cursor: " cursor ", total: 12, scanned: 5, enqueued: 2, last_error: null, last_run_at: 1700000000 } } };

test("backfill KV parser accepts valid producer numbers and numeric strings", () => {
  for (const number of [12, "12"]) {
    const parsed = parseStaticBackfillState({ ...valid, updated_at: "1700000000", runs: { video_v2: { ...valid.runs.video_v2, total: number, scanned: "5", enqueued: 2, last_run_at: "1700000000" } } });
    assert.equal(parsed.updated_at, 1700000000);
    assert.equal(parsed.runs.video_v2.total, 12);
    assert.equal(parsed.runs.video_v2.scanned, 5);
    assert.equal(parsed.runs.video_v2.last_run_at, 1700000000);
    assert.equal(parsed.runs.video_v2.cursor, "cursor");
    assert.equal(parsed.runs.video_v2.phase, "shared_inputs");
  }
});

test("backfill KV parser rejects coerced schema and malformed envelope", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(value), createEmptyStaticBackfillState());
  }
});

test("backfill KV parser zeroes malformed counters without inventing timestamps", () => {
  for (const bad of [true, false, [], [5], {}, "", " ", Infinity, "Infinity", "1e309", null, undefined]) {
    const parsed = parseStaticBackfillState({ ...valid, updated_at: bad, runs: { video_v2: { ...valid.runs.video_v2, total: bad, scanned: bad, enqueued: bad, last_run_at: bad } } });
    assert.equal(parsed.updated_at, null);
    assert.equal(parsed.runs.video_v2.total, 0);
    assert.equal(parsed.runs.video_v2.scanned, 0);
    assert.equal(parsed.runs.video_v2.enqueued, 0);
    assert.equal(parsed.runs.video_v2.last_run_at, null);
  }
});

test("backfill KV parser preserves flooring, nonnegative counts and idle defaults", () => {
  const parsed = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...valid.runs.video_v2, total: -3, scanned: "3.9", enqueued: 0, last_run_at: 4.9 } } });
  assert.equal(parsed.runs.video_v2.total, 0);
  assert.equal(parsed.runs.video_v2.scanned, 3);
  assert.equal(parsed.runs.video_v2.last_run_at, 4);
  assert.equal(parsed.runs.user_profile.status, "idle");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const validRun = { cursor: " a ", phase: "items", status: "running", total: 5, scanned: 3, enqueued: 2, last_error: null, last_run_at: 100 };
const valid = { schema_version: 1, updated_at: 100, runs: { video_v2: validRun } };

test("static backfill accepts valid numeric values and numeric strings", () => {
  const result = parseStaticBackfillState({ ...valid, updated_at: "100", runs: { video_v2: { ...validRun, total: "5", scanned: "3", enqueued: "2", last_run_at: "100" } } });
  assert.equal(result.updated_at, 100);
  assert.deepEqual([result.runs.video_v2.total, result.runs.video_v2.scanned, result.runs.video_v2.enqueued, result.runs.video_v2.last_run_at], [5, 3, 2, 100]);
  assert.equal(result.runs.video_v2.cursor, "a");
  assert.equal(result.runs.video_v2.status, "running");
});

test("static backfill rejects coerced schema and array envelopes", () => {
  for (const input of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(input), createEmptyStaticBackfillState());
  }
});

test("static backfill rejects malformed counters and timestamps", () => {
  for (const bad of [true, false, [], [5], {}, " ", "", null, undefined, Infinity, "Infinity", "1e309"]) {
    const parsed = parseStaticBackfillState({ ...valid, updated_at: bad, runs: { video_v2: { ...validRun, total: bad, scanned: bad, enqueued: bad, last_run_at: bad } } });
    assert.equal(parsed.updated_at, null);
    assert.deepEqual([parsed.runs.video_v2.total, parsed.runs.video_v2.scanned, parsed.runs.video_v2.enqueued, parsed.runs.video_v2.last_run_at], [0, 0, 0, null]);
  }
});

test("static backfill preserves safe defaults, clamping, and flooring", () => {
  const result = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...validRun, total: -2, scanned: 4.9, enqueued: 2.9, last_run_at: 10.9 } } });
  assert.deepEqual([result.runs.video_v2.total, result.runs.video_v2.scanned, result.runs.video_v2.enqueued, result.runs.video_v2.last_run_at], [0, 4, 2, 10]);
  assert.equal(result.runs.user_profile.status, "idle");
  assert.equal(result.runs.event_crew.total, 0);
});

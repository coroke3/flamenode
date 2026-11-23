import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const run = { cursor: " next ", phase: "shared_inputs", status: "running", total: 12, scanned: 5, enqueued: 3, last_error: null, last_run_at: 1700000000 };
const valid = { schema_version: 1, updated_at: 1700000000, runs: { video_v2: run } };

test("static backfill preserves numeric primitives and numeric strings", () => {
  const parsed = parseStaticBackfillState({ ...valid, updated_at: "1700000000", runs: { video_v2: { ...run, total: "12", scanned: "5.9", enqueued: "3", last_run_at: "1700000000" } } });
  assert.equal(parsed.updated_at, 1700000000);
  assert.equal(parsed.runs.video_v2.total, 12);
  assert.equal(parsed.runs.video_v2.scanned, 5);
  assert.equal(parsed.runs.video_v2.enqueued, 3);
  assert.equal(parsed.runs.video_v2.last_run_at, 1700000000);
  assert.equal(parsed.runs.video_v2.cursor, "next");
  assert.equal(parsed.runs.video_v2.phase, "shared_inputs");
  assert.equal(parsed.runs.video_v2.status, "running");
});

test("static backfill rejects coerced schema and array envelopes", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(value), createEmptyStaticBackfillState());
  }
});

test("static backfill defaults malformed counters and nullable timestamps", () => {
  for (const invalid of [true, false, [], [5], {}, " ", "", null, undefined, "Infinity", Infinity, "1e309"]) {
    const parsed = parseStaticBackfillState({ ...valid, updated_at: invalid, runs: { video_v2: { ...run, total: invalid, scanned: invalid, enqueued: invalid, last_run_at: invalid } } });
    assert.equal(parsed.updated_at, null);
    assert.equal(parsed.runs.video_v2.total, 0);
    assert.equal(parsed.runs.video_v2.scanned, 0);
    assert.equal(parsed.runs.video_v2.enqueued, 0);
    assert.equal(parsed.runs.video_v2.last_run_at, null);
  }
});

test("static backfill preserves counter clamping and missing run defaults", () => {
  const parsed = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: -3, scanned: 4.9, enqueued: 0 } } });
  assert.equal(parsed.runs.video_v2.total, 0);
  assert.equal(parsed.runs.video_v2.scanned, 4);
  assert.equal(parsed.runs.user_profile.status, "idle");
  assert.equal(parsed.runs.event_crew.total, 0);
});

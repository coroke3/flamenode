import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const run = { cursor: " next ", phase: "shared_inputs", status: "running", total: 10, scanned: 5, enqueued: 3, last_error: null, last_run_at: 1700000000 };
const valid = { schema_version: 1, updated_at: 1700000000, runs: { video_v2: run } };

test("static backfill accepts finite numeric primitives and strings", () => {
  const parsed = parseStaticBackfillState({ ...valid, updated_at: "1700000000", runs: { video_v2: { ...run, total: "10.9", last_run_at: "1700000000" } } });
  assert.equal(parsed.updated_at, 1700000000);
  assert.equal(parsed.runs.video_v2.total, 10);
  assert.equal(parsed.runs.video_v2.last_run_at, 1700000000);
  assert.equal(parsed.runs.video_v2.cursor, "next");
  assert.equal(parsed.runs.video_v2.phase, "shared_inputs");
});

test("static backfill rejects coerced schema and invalid envelope", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(value), createEmptyStaticBackfillState());
  }
});

test("static backfill malformed counters fall back to zero", () => {
  for (const invalid of [true, false, [], [5], {}, " ", "", Infinity, "Infinity", "1e309", null, undefined]) {
    const parsed = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: invalid, scanned: invalid, enqueued: invalid } } });
    assert.equal(parsed.runs.video_v2.total, 0);
    assert.equal(parsed.runs.video_v2.scanned, 0);
    assert.equal(parsed.runs.video_v2.enqueued, 0);
  }
});

test("static backfill malformed timestamps fall back to null", () => {
  for (const invalid of [true, false, [], [5], {}, " ", "", Infinity, "Infinity", "1e309", null, undefined]) {
    const parsed = parseStaticBackfillState({ ...valid, updated_at: invalid, runs: { video_v2: { ...run, last_run_at: invalid } } });
    assert.equal(parsed.updated_at, null);
    assert.equal(parsed.runs.video_v2.last_run_at, null);
  }
});

test("static backfill keeps missing runs and negative count defaults", () => {
  const parsed = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: -10 } } });
  assert.equal(parsed.runs.video_v2.total, 0);
  assert.equal(parsed.runs.user_profile.status, "idle");
  assert.equal(parsed.runs.event_crew.scanned, 0);
});

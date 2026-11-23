import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStaticBackfillState, parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const run = { cursor: " next ", phase: "shared_inputs", status: "running", total: 5, scanned: "3", enqueued: 2, last_error: null, last_run_at: 1700000000 };
const valid = { schema_version: 1, updated_at: "1700000000", runs: { video_v2: run } };

test("static backfill state preserves valid numeric and string counters", () => {
  const result = parseStaticBackfillState(valid);
  assert.equal(result.updated_at, 1700000000);
  assert.equal(result.runs.video_v2.total, 5);
  assert.equal(result.runs.video_v2.scanned, 3);
  assert.equal(result.runs.video_v2.cursor, "next");
  assert.equal(result.runs.video_v2.phase, "shared_inputs");
  assert.equal(result.runs.video_v2.status, "running");
});

test("static backfill state rejects coerced schemas and malformed envelopes", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }]) {
    assert.deepEqual(parseStaticBackfillState(value), createEmptyStaticBackfillState());
  }
});

test("static backfill counters reject coerced values and preserve safe zero fallback", () => {
  for (const bad of [true, false, [], [5], {}, "", " ", Infinity, "Infinity", "1e309", null, undefined]) {
    const state = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: bad, scanned: bad, enqueued: bad } } });
    assert.equal(state.runs.video_v2.total, 0);
    assert.equal(state.runs.video_v2.scanned, 0);
    assert.equal(state.runs.video_v2.enqueued, 0);
  }
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: -3.1 } } }).runs.video_v2.total, 0);
  assert.equal(parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: "3.9" } } }).runs.video_v2.total, 3);
});

test("static backfill timestamps reject coerced values without inventing zero", () => {
  for (const bad of [true, false, [], [5], {}, "", " ", Infinity, "Infinity", "1e309", null, undefined]) {
    const state = parseStaticBackfillState({ ...valid, updated_at: bad, runs: { video_v2: { ...run, last_run_at: bad } } });
    assert.equal(state.updated_at, null);
    assert.equal(state.runs.video_v2.last_run_at, null);
  }
});

test("static backfill defaults missing runs and preserves status semantics", () => {
  const state = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, status: "invalid" } } });
  assert.equal(state.runs.video_v2.status, "idle");
  assert.equal(state.runs.user_profile.total, 0);
  assert.equal(state.runs.event_crew.status, "idle");
});

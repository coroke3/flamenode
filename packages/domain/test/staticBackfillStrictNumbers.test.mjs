import test from "node:test";
import assert from "node:assert/strict";
import { parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const run = { status: "running", phase: "shared_inputs", cursor: " abc ", total: 12, scanned: 4, enqueued: 3, last_error: null, last_run_at: 1700000000 };
const payload = { schema_version: 1, updated_at: 1700000000, runs: { video_v2: run } };

test("static backfill preserves valid numeric values and numeric strings", () => {
  for (const value of [12, "12"]) {
    const result = parseStaticBackfillState({ ...payload, updated_at: "1700000000", runs: { video_v2: { ...run, total: value, scanned: "4", last_run_at: "1700000000" } } });
    assert.equal(result.runs.video_v2.total, 12);
    assert.equal(result.runs.video_v2.scanned, 4);
    assert.equal(result.runs.video_v2.last_run_at, 1700000000);
    assert.equal(result.updated_at, 1700000000);
    assert.equal(result.runs.video_v2.cursor, "abc");
    assert.equal(result.runs.video_v2.status, "running");
  }
});

test("static backfill rejects coerced schema and arrays as state", () => {
  for (const value of [null, [], { ...payload, schema_version: true }, { ...payload, schema_version: "1" }, { ...payload, schema_version: [1] }, { ...payload, runs: [] }]) {
    const state = parseStaticBackfillState(value);
    assert.equal(state.updated_at, null);
    assert.equal(state.runs.video_v2.status, "idle");
  }
});

test("static backfill rejects invalid counters and timestamps without fabricating progress", () => {
  for (const invalid of [true, false, [], [5], {}, " ", "", Infinity, "Infinity", "1e309", null]) {
    const state = parseStaticBackfillState({ ...payload, updated_at: invalid, runs: { video_v2: { ...run, total: invalid, scanned: invalid, enqueued: invalid, last_run_at: invalid } } });
    assert.equal(state.updated_at, null);
    assert.equal(state.runs.video_v2.total, 0);
    assert.equal(state.runs.video_v2.scanned, 0);
    assert.equal(state.runs.video_v2.enqueued, 0);
    assert.equal(state.runs.video_v2.last_run_at, null);
  }
});

test("static backfill preserves counter flooring and nullable defaults", () => {
  const state = parseStaticBackfillState({ ...payload, runs: { video_v2: { ...run, total: -1, scanned: 2.9, enqueued: "3.9", last_run_at: undefined } } });
  assert.equal(state.runs.video_v2.total, 0);
  assert.equal(state.runs.video_v2.scanned, 2);
  assert.equal(state.runs.video_v2.enqueued, 3);
  assert.equal(state.runs.video_v2.last_run_at, null);
  assert.equal(state.runs.user_profile.status, "idle");
});

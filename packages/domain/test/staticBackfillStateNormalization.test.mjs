import test from "node:test";
import assert from "node:assert/strict";
import { parseStaticBackfillState } from "../src/admin/staticBackfillState.ts";

const run = { phase: "items", status: "running", cursor: " next ", total: 12, scanned: 5, enqueued: 3, last_error: null, last_run_at: 1700000000 };
const valid = { schema_version: 1, updated_at: 1700000000, runs: { video_v2: run } };

test("static backfill state preserves valid numeric and string values", () => {
  for (const n of [5, "5"]) {
    const result = parseStaticBackfillState({ ...valid, updated_at: "1700000000", runs: { video_v2: { ...run, total: n, scanned: n, last_run_at: "1700000000" } } });
    assert.equal(result.updated_at, 1700000000);
    assert.equal(result.runs.video_v2.total, 5);
    assert.equal(result.runs.video_v2.scanned, 5);
    assert.equal(result.runs.video_v2.last_run_at, 1700000000);
    assert.equal(result.runs.video_v2.cursor, "next");
  }
});

test("static backfill rejects malformed schema and state containers", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, runs: [] }, { ...valid, runs: null }]) {
    assert.deepEqual(parseStaticBackfillState(value).runs.video_v2.status, "idle");
  }
});

test("static backfill counters reject coercion and fall back to zero", () => {
  for (const n of [true, false, [], [5], {}, "", " ", "Infinity", Infinity, NaN, null]) {
    const result = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: n, scanned: n, enqueued: n } } });
    assert.equal(result.runs.video_v2.total, 0);
    assert.equal(result.runs.video_v2.scanned, 0);
    assert.equal(result.runs.video_v2.enqueued, 0);
  }
});

test("static backfill timestamps reject coercion and fall back to null", () => {
  for (const n of [true, false, [], [5], {}, "", " ", "Infinity", Infinity, NaN, null]) {
    const result = parseStaticBackfillState({ ...valid, updated_at: n, runs: { video_v2: { ...run, last_run_at: n } } });
    assert.equal(result.updated_at, null);
    assert.equal(result.runs.video_v2.last_run_at, null);
  }
});

test("static backfill retains counter flooring and safe empty defaults", () => {
  const result = parseStaticBackfillState({ ...valid, runs: { video_v2: { ...run, total: -3, scanned: 3.9, enqueued: "4.9" } } });
  assert.equal(result.runs.video_v2.total, 0);
  assert.equal(result.runs.video_v2.scanned, 3);
  assert.equal(result.runs.video_v2.enqueued, 4);
  assert.equal(result.runs.event_crew.status, "idle");
});

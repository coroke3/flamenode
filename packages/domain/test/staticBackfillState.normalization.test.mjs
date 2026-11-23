import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyStaticBackfillState,
  parseStaticBackfillState,
} from "../src/admin/staticBackfillState.ts";

test("static backfill state requires the literal numeric schema version", () => {
  for (const schemaVersion of ["1", true, false, [], [1], {}, " "]) {
    assert.deepEqual(
      parseStaticBackfillState({ schema_version: schemaVersion, runs: {} }),
      createEmptyStaticBackfillState(),
      JSON.stringify(schemaVersion),
    );
  }
});

test("static backfill run status is not coerced from arrays or objects", () => {
  for (const status of [["running"], {}, true, 1]) {
    const state = parseStaticBackfillState({
      schema_version: 1,
      runs: { video_v2: { status } },
    });
    assert.equal(state.runs.video_v2.status, "idle", JSON.stringify(status));
  }
});

test("static backfill counters reject booleans, arrays, objects and blank strings", () => {
  const invalidValues = [true, false, [], [5], {}, " ", "not-a-number"];
  for (const invalid of invalidValues) {
    const state = parseStaticBackfillState({
      schema_version: 1,
      runs: {
        video_v2: {
          status: "running",
          total: invalid,
          scanned: invalid,
          enqueued: invalid,
        },
      },
    });
    assert.equal(state.runs.video_v2.total, 0, JSON.stringify(invalid));
    assert.equal(state.runs.video_v2.scanned, 0, JSON.stringify(invalid));
    assert.equal(state.runs.video_v2.enqueued, 0, JSON.stringify(invalid));
  }
});

test("static backfill timestamps reject coercible JSON values and keep nullable defaults", () => {
  for (const invalid of [true, false, [], [1729000000], {}, " ", "invalid"]) {
    const state = parseStaticBackfillState({
      schema_version: 1,
      updated_at: invalid,
      runs: { video_v2: { last_run_at: invalid } },
    });
    assert.equal(state.updated_at, null, JSON.stringify(invalid));
    assert.equal(state.runs.video_v2.last_run_at, null, JSON.stringify(invalid));
  }

  const empty = parseStaticBackfillState({
    schema_version: 1,
    updated_at: null,
    runs: { video_v2: { total: null, scanned: "", last_run_at: null } },
  });
  assert.equal(empty.updated_at, null);
  assert.equal(empty.runs.video_v2.total, 0);
  assert.equal(empty.runs.video_v2.scanned, 0);
  assert.equal(empty.runs.video_v2.last_run_at, null);
});

test("valid numeric and numeric-string backfill state values retain their values", () => {
  const state = parseStaticBackfillState({
    schema_version: 1,
    updated_at: "1729000000",
    runs: {
      video_v2: {
        status: "running",
        phase: "shared_inputs",
        cursor: " cursor-1 ",
        total: "7",
        scanned: 12.9,
        enqueued: 8,
        last_run_at: "1710000000",
      },
    },
  });

  assert.equal(state.schema_version, 1);
  assert.equal(state.updated_at, 1729000000);
  assert.equal(state.runs.video_v2.status, "running");
  assert.equal(state.runs.video_v2.phase, "shared_inputs");
  assert.equal(state.runs.video_v2.cursor, "cursor-1");
  assert.equal(state.runs.video_v2.total, 7);
  assert.equal(state.runs.video_v2.scanned, 12);
  assert.equal(state.runs.video_v2.enqueued, 8);
  assert.equal(state.runs.video_v2.last_run_at, 1710000000);
});

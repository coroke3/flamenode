import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyStaticBackfillState,
  parseStaticBackfillState,
  withStaticBackfillRun,
} from "./backfillStateCore.ts";

test("不正な値は空のバックフィル状態へ戻す", () => {
  const state = parseStaticBackfillState({
    schema_version: 2,
  });

  assert.equal(state.runs.video_v2.status, "idle");
  assert.equal(state.runs.video_v2.scanned, 0);
});

test("cursorと累積進捗を保存する", () => {
  const empty = createEmptyStaticBackfillState();

  const next = withStaticBackfillRun(
    empty,
    "video_v2",
    {
      cursor: "video-012",
      status: "running",
      total: 100,
      scanned: 12,
      enqueued: 12,
      last_error: null,
      last_run_at: 1000,
    },
    1000,
  );

  const parsed = parseStaticBackfillState(JSON.parse(JSON.stringify(next)));

  assert.equal(parsed.runs.video_v2.cursor, "video-012");
  assert.equal(parsed.runs.video_v2.scanned, 12);
  assert.equal(parsed.runs.video_v2.status, "running");
});

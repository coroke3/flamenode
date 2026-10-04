import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePublicDataState,
  shouldAttemptDegradedD1AfterPublicMiss,
  shouldPublicPageNotFound,
  shouldPublicPageShowReflection,
} from "./publicDataState.ts";

test("public 対象で enqueue 成功は reflecting", () => {
  assert.equal(
    resolvePublicDataState({
      hasRenderableData: false,
      probe: { state: "public", canonicalTargetId: "video-1" },
      enqueued: true,
      mode: "unavailable",
    }),
    "reflecting",
  );
});

test("not_public / missing は not_found", () => {
  assert.equal(
    resolvePublicDataState({
      hasRenderableData: false,
      probe: { state: "not_public", canonicalTargetId: "video-1" },
      enqueued: false,
      mode: "unavailable",
    }),
    "not_found",
  );
  assert.equal(
    resolvePublicDataState({
      hasRenderableData: false,
      probe: { state: "missing" },
      enqueued: false,
      mode: "unavailable",
    }),
    "not_found",
  );
});

test("probe 失敗は unavailable", () => {
  assert.equal(
    resolvePublicDataState({
      hasRenderableData: false,
      probe: { state: "unknown", errorCode: "D1Error" },
      enqueued: false,
      mode: "unavailable",
    }),
    "unavailable",
  );
});

test("public miss degraded D1 fallback is admitted only to the rebuild claimant", () => {
  const publicProbe = { state: "public", canonicalTargetId: "video-1" };
  assert.equal(
    shouldAttemptDegradedD1AfterPublicMiss({
      probe: publicProbe,
      rebuildClaimed: true,
    }),
    true,
  );
  for (const state of ["unknown", "missing", "not_public"]) {
    assert.equal(
      shouldAttemptDegradedD1AfterPublicMiss({
        probe:
          state === "unknown"
            ? { state, errorCode: "D1Error" }
            : state === "missing"
              ? { state }
              : { state, canonicalTargetId: "video-1" },
        rebuildClaimed: true,
      }),
      false,
    );
  }
  assert.equal(
    shouldAttemptDegradedD1AfterPublicMiss({
      probe: publicProbe,
      rebuildClaimed: false,
    }),
    false,
  );
});

test("public page helpers", () => {
  assert.equal(shouldPublicPageShowReflection("reflecting"), true);
  assert.equal(shouldPublicPageNotFound("not_found"), true);
  assert.equal(shouldPublicPageNotFound("reflecting"), false);
});

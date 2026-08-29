import assert from "node:assert/strict";
import test from "node:test";
import {
  staticR2CacheControl,
  STATIC_R2_MAX_AGE_SEC,
} from "./staticR2CacheControl.ts";

test("staticR2CacheControl emits max-age and stale-while-revalidate", () => {
  assert.equal(
    staticR2CacheControl(120),
    "public, max-age=120, stale-while-revalidate=600",
  );
});

test("STATIC_R2_MAX_AGE_SEC aligns video and list recent targets", () => {
  assert.equal(STATIC_R2_MAX_AGE_SEC.videoDetail, 180);
  assert.equal(STATIC_R2_MAX_AGE_SEC.listRecent, 180);
  assert.equal(STATIC_R2_MAX_AGE_SEC.rules, 3600);
  assert.equal(STATIC_R2_MAX_AGE_SEC.trending, 300);
});

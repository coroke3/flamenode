/**
 * operation_mode 別の公開 JSON ローダー挙動。
 *
 * Usage: node --test src/lib/publicData/loader.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  canFallbackToDatabase,
  isMaintenanceStrategy,
  shouldUseStaticCollection,
} from "./loaderPolicy.ts";

test("canFallbackToDatabase: overlay のみ DB fallback 可", () => {
  assert.equal(canFallbackToDatabase("static_json_with_live_overlay"), true);
  assert.equal(canFallbackToDatabase("static_json_only"), false);
  assert.equal(canFallbackToDatabase("maintenance"), false);
});

test("isMaintenanceStrategy", () => {
  assert.equal(isMaintenanceStrategy("maintenance"), true);
  assert.equal(isMaintenanceStrategy("static_json_only"), false);
});

test("overlay treats an empty static collection as a DB fallback miss", () => {
  assert.equal(
    shouldUseStaticCollection("static_json_with_live_overlay", 0),
    false,
  );
  assert.equal(
    shouldUseStaticCollection("static_json_with_live_overlay", 1),
    true,
  );
  assert.equal(shouldUseStaticCollection("static_json_only", 0), true);
  assert.equal(shouldUseStaticCollection("maintenance", 0), true);
});

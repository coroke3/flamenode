import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_QUEUE_ITEMS_ECONOMY,
  MAX_QUEUE_ITEMS_PER_RUN,
  queueLimitForMode,
} from "./queuePolicy.ts";

test("normalも1回最大1件", () => {
  assert.equal(MAX_QUEUE_ITEMS_PER_RUN, 1);
  assert.equal(queueLimitForMode("normal"), 1);
});

test("economyは1回最大1件", () => {
  assert.equal(MAX_QUEUE_ITEMS_ECONOMY, 1);
  assert.equal(queueLimitForMode("economy"), 1);
});

test("全modeでFree CPU向け上限を超えない", () => {
  for (const mode of ["normal", "economy", "read_only", "static_only", "maintenance"]) {
    assert.ok(queueLimitForMode(mode) <= 1);
  }
});

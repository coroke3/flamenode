import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_QUEUE_ITEMS_ECONOMY,
  MAX_QUEUE_ITEMS_PER_RUN,
  queueLimitForMode,
} from "./queuePolicy.ts";

test("normalは1回最大3件", () => {
  assert.equal(MAX_QUEUE_ITEMS_PER_RUN, 3);
  assert.equal(queueLimitForMode("normal"), 3);
});

test("economyは1回最大1件", () => {
  assert.equal(MAX_QUEUE_ITEMS_ECONOMY, 1);
  assert.equal(queueLimitForMode("economy"), 1);
});

test("maintenanceは呼び出し側で停止し、上限は通常値を超えない", () => {
  assert.ok(
    queueLimitForMode("maintenance") <=
      MAX_QUEUE_ITEMS_PER_RUN,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  queueLimitForMode,
  queueModeWhereClause,
  resolveQueueOperationMode,
  shouldReconcileStaleQueue,
  shouldSkipQueueTarget,
} from "./queuePolicy.ts";

test("resolveQueueOperationMode: operation_mode を正本にする", () => {
  assert.equal(
    resolveQueueOperationMode({
      operation_mode: "static_only",
      cost_guard_mode: "normal",
      is_maintenance_mode: 0,
    }),
    "static_only",
  );
});

test("resolveQueueOperationMode: 旧 cost_guard_mode へ fallback", () => {
  assert.equal(
    resolveQueueOperationMode({
      operation_mode: "broken",
      cost_guard_mode: "economy",
      is_maintenance_mode: 0,
    }),
    "economy",
  );
});

test("resolveQueueOperationMode: 旧 maintenance flag は安全側で停止", () => {
  assert.equal(
    resolveQueueOperationMode({
      operation_mode: "normal",
      cost_guard_mode: "normal",
      is_maintenance_mode: 1,
    }),
    "maintenance",
  );
});

test("queueLimitForMode: economy だけ処理件数を絞る", () => {
  assert.equal(queueLimitForMode("normal"), 20);
  assert.equal(queueLimitForMode("economy"), 5);
  assert.equal(queueLimitForMode("static_only"), 20);
});

test("queueModeWhereClause: mode 別に pending 対象を絞る", () => {
  assert.equal(queueModeWhereClause("normal"), "");
  assert.match(queueModeWhereClause("static_only"), /priority = 'high'/);
  assert.match(queueModeWhereClause("read_only"), /target_type IN/);
});

test("shouldSkipQueueTarget: economy は重い派生ターゲットを high 以外でスキップ", () => {
  assert.equal(
    shouldSkipQueueTarget("economy", { target_type: "search_index", priority: "normal" }),
    true,
  );
  assert.equal(
    shouldSkipQueueTarget("economy", { target_type: "list_popular", priority: "high" }),
    false,
  );
  assert.equal(
    shouldSkipQueueTarget("normal", { target_type: "search_index", priority: "normal" }),
    false,
  );
});

test("shouldReconcileStaleQueue: stale 整理は normal/economy のみ", () => {
  assert.equal(shouldReconcileStaleQueue("normal"), true);
  assert.equal(shouldReconcileStaleQueue("economy"), true);
  assert.equal(shouldReconcileStaleQueue("read_only"), false);
  assert.equal(shouldReconcileStaleQueue("maintenance"), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUEUE_FREE_TIER_BUDGET,
  QUEUE_WAKE_MESSAGE_VERSION,
} from "./wakeBudget.ts";
import {
  assertQueueWakeMessageWithinBudget,
  createQueueWakeMessage,
  estimateQueueWakeMessageBytes,
  parseQueueWakeMessage,
} from "./wakeMessage.ts";
import { resolveQueueFeatureFlags } from "./featureFlags.ts";

test("wake message stays under 1KB and excludes business fields", () => {
  const message = createQueueWakeMessage({
    kind: "notification_available",
    source: "web",
  });
  assert.equal(message.version, QUEUE_WAKE_MESSAGE_VERSION);
  const bytes = estimateQueueWakeMessageBytes(message);
  assert.ok(bytes < QUEUE_FREE_TIER_BUDGET.maxMessageBytes);
  assertQueueWakeMessageWithinBudget(message);
  assert.equal(
    parseQueueWakeMessage({
      ...message,
      recipient_user_id: "user_1",
    }),
    null,
  );
});

test("feature flags default to disabled and never require D1", () => {
  assert.deepEqual(resolveQueueFeatureFlags(null), {
    dispatchEnabled: false,
    continuationEnabled: false,
    youtubeSyncEnabled: false,
  });
  assert.equal(
    resolveQueueFeatureFlags({ QUEUE_DISPATCH_ENABLED: "1" }).dispatchEnabled,
    true,
  );
});

test("free tier budget constants are documented as single source", () => {
  assert.equal(QUEUE_FREE_TIER_BUDGET.maxNormalMessagesPerDay, 2_000);
  assert.equal(QUEUE_FREE_TIER_BUDGET.maxNormalOperationsPerDay, 6_000);
  assert.equal(QUEUE_FREE_TIER_BUDGET.reservedOperationsPerDay, 4_000);
  assert.equal(QUEUE_FREE_TIER_BUDGET.notificationBatchSize, 6);
  assert.equal(QUEUE_FREE_TIER_BUDGET.staticRebuildTargetsPerInvocation, 1);
  assert.equal(QUEUE_FREE_TIER_BUDGET.youtubePendingBatchSize, 50);
});

import type { QueueWakeKind } from "../../src/lib/queues/wakeBudget.ts";
import {
  QUEUE_WAKE_LAST_FAILURE_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  recordQueueWakeFailureBestEffortCore,
  resetQueueWakeFailureRecordStateForTests,
  serializeQueueWakeLastFailure,
} from "../../src/lib/queues/wakeFailureRecordCore.ts";

export {
  QUEUE_WAKE_LAST_FAILURE_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  serializeQueueWakeLastFailure,
};

/**
 * Worker 側 Queue wake 失敗の last-failure 記録（best-effort）。
 */
export async function recordQueueWakeFailureBestEffort(input: {
  kind: QueueWakeKind;
  reason: string;
  kv?: KVNamespace | null;
}): Promise<void> {
  await recordQueueWakeFailureBestEffortCore("queue-wake-worker", {
    ...input,
    kv: input.kv ?? null,
  });
}

export { resetQueueWakeFailureRecordStateForTests };

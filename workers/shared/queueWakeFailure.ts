import type { QueueWakeKind } from "../../src/lib/queues/wakeBudget.ts";
import {
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  serializeQueueWakeLastFailure,
} from "../../src/lib/queues/wakeFailureRecordCore.ts";

export {
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
  const payload = serializeQueueWakeLastFailure(input.reason);
  const kv = input.kv ?? null;

  if (!kv || typeof kv.put !== "function") {
    console.warn(
      JSON.stringify({
        service: "queue-wake-worker",
        result: "last_failure_record_skipped",
        kind: input.kind,
        reason: input.reason,
      }),
    );
    return;
  }

  try {
    await kv.put(queueWakeLastFailureKvKey(input.kind), payload, {
      expirationTtl: QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "queue-wake-worker",
        result: "last_failure_record_failed",
        kind: input.kind,
        reason: input.reason,
        error_name: error instanceof Error ? error.name : undefined,
      }),
    );
  }
}

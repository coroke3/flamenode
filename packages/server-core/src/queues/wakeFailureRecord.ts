import type { KvPort, QueueWakeHost } from "../ports.ts";
import type { QueueWakeKind } from "./wakeBudget.ts";
import {
  recordQueueWakeFailureBestEffortCore,
  resetQueueWakeFailureRecordStateForTests,
} from "./wakeFailureRecordCore.ts";

export {
  QUEUE_WAKE_LAST_FAILURE_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  serializeQueueWakeLastFailure,
} from "./wakeFailureRecordCore.ts";

/**
 * Queue wake 送信失敗を KV に上書き記録する（best-effort）。
 * 個人情報は reason コードのみ。KV 無し / 失敗時は console.warn のみ。
 */
export async function recordQueueWakeFailureBestEffort(
  input: {
    kind: QueueWakeKind;
    reason: string;
    kv?: Pick<KvPort, "put"> | null;
  },
  host: QueueWakeHost,
): Promise<void> {
  let kv = input.kv;
  if (kv === undefined) {
    try {
      kv = host.readKv();
    } catch {
      kv = null;
    }
  }

  await recordQueueWakeFailureBestEffortCore("queue-wake", {
    ...input,
    kv,
  });
}

export { resetQueueWakeFailureRecordStateForTests };

// Compatibility bridge (MIG-0613, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import type { KvPort } from "@flamenode/server-core/ports";
import { recordQueueWakeFailureBestEffort as recordQueueWakeFailureBestEffortCore } from "@flamenode/server-core/queues/wakeFailureRecord";
import type { QueueWakeKind } from "@flamenode/server-core/queues/wakeBudget";

export {
  QUEUE_WAKE_LAST_FAILURE_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  resetQueueWakeFailureRecordStateForTests,
  serializeQueueWakeLastFailure,
} from "@flamenode/server-core/queues/wakeFailureRecord";

/**
 * Queue wake 送信失敗を KV に上書き記録する（best-effort）。
 * 個人情報は reason コードのみ。KV 無し / 失敗時は console.warn のみ。
 */
export function recordQueueWakeFailureBestEffort(input: {
  kind: QueueWakeKind;
  reason: string;
  kv?: Pick<KvPort, "put"> | null;
}): Promise<void> {
  return recordQueueWakeFailureBestEffortCore(input, nextQueueWakeHost);
}

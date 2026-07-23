import "server-only";

import { getEnv } from "@/lib/cloudflare";
import type { QueueWakeKind } from "./wakeBudget";
import {
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  serializeQueueWakeLastFailure,
} from "./wakeFailureRecordCore";

export {
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  serializeQueueWakeLastFailure,
} from "./wakeFailureRecordCore";

/**
 * Queue wake 送信失敗を KV に上書き記録する（best-effort）。
 * 個人情報は reason コードのみ。KV 無し / 失敗時は console.warn のみ。
 */
export async function recordQueueWakeFailureBestEffort(input: {
  kind: QueueWakeKind;
  reason: string;
  kv?: KVNamespace | null;
}): Promise<void> {
  const payload = serializeQueueWakeLastFailure(input.reason);

  let kv = input.kv;
  if (kv === undefined) {
    try {
      kv = getEnv().KV ?? null;
    } catch {
      kv = null;
    }
  }

  if (!kv || typeof kv.put !== "function") {
    console.warn(
      JSON.stringify({
        service: "queue-wake",
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
        service: "queue-wake",
        result: "last_failure_record_failed",
        kind: input.kind,
        reason: input.reason,
        error_name: error instanceof Error ? error.name : undefined,
      }),
    );
  }
}

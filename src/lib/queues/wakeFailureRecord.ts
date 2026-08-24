import "server-only";

import { getEnv } from "@/lib/cloudflare";
import type { QueueWakeKind } from "./wakeBudget";
import {
  QUEUE_WAKE_LAST_FAILURE_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  serializeQueueWakeLastFailure,
} from "./wakeFailureRecordCore";

export {
  QUEUE_WAKE_LAST_FAILURE_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS,
  QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
  queueWakeLastFailureKvKey,
  serializeQueueWakeLastFailure,
} from "./wakeFailureRecordCore";

type FailureWriteState = {
  kv: KVNamespace;
  reason: string;
  attemptedAt: number;
};

// QueueWakeKind is a fixed, bounded set, so this map cannot grow with input.
const recentFailureWrites = new Map<string, FailureWriteState>();

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

  const now = Date.now();
  const previous = recentFailureWrites.get(input.kind);
  if (
    previous &&
    previous.kv === kv &&
    now - previous.attemptedAt <
      (previous.reason === input.reason
        ? QUEUE_WAKE_LAST_FAILURE_COALESCE_MS
        : QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS)
  ) {
    return;
  }
  recentFailureWrites.set(input.kind, {
    kv,
    reason: input.reason,
    attemptedAt: now,
  });

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

export function resetQueueWakeFailureRecordStateForTests(): void {
  recentFailureWrites.clear();
}

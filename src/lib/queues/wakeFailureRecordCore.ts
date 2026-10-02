import type { QueueWakeKind } from "./wakeBudget";

/** last-failure 上書きの TTL（7日）。 */
export const QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The last-failure key is diagnostic only.  Coalesce identical writes within
 * one isolate so a queue outage/retry storm does not repeatedly write the
 * same KV key.  A different reason is eligible after the one-second
 * same-key rate window, so the diagnostic value stays current without
 * violating KV throttling.
 */
export const QUEUE_WAKE_LAST_FAILURE_COALESCE_MS = 30_000;
/** A changed failure class is allowed through after the KV one-second rate window. */
export const QUEUE_WAKE_LAST_FAILURE_REASON_COALESCE_MS = 1_000;

export function queueWakeLastFailureKvKey(kind: QueueWakeKind): string {
  return `queue_wake:last_failure:${kind}`;
}

export function serializeQueueWakeLastFailure(reason: string): string {
  return JSON.stringify({
    at: Math.floor(Date.now() / 1000),
    reason,
  });
}

type FailureWriteState = {
  kv: KVNamespace;
  reason: string;
  attemptedAt: number;
};

// QueueWakeKind is a fixed, bounded set, so this map cannot grow with input.
const recentFailureWrites = new Map<string, FailureWriteState>();

/**
 * last-failure 記録の共有実装（best-effort）。
 * server 側と worker 側の wrapper から service 名だけ変えて呼ばれる。
 */
export async function recordQueueWakeFailureBestEffortCore(
  service: string,
  input: {
    kind: QueueWakeKind;
    reason: string;
    kv: KVNamespace | null;
  },
): Promise<void> {
  const kv = input.kv;

  if (!kv || typeof kv.put !== "function") {
    console.warn(
      JSON.stringify({
        service,
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
    await kv.put(queueWakeLastFailureKvKey(input.kind), serializeQueueWakeLastFailure(input.reason), {
      expirationTtl: QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        service,
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

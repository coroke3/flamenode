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

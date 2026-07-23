import type { QueueWakeKind } from "./wakeBudget";

/** last-failure 上書きの TTL（7日）。 */
export const QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function queueWakeLastFailureKvKey(kind: QueueWakeKind): string {
  return `queue_wake:last_failure:${kind}`;
}

export function serializeQueueWakeLastFailure(reason: string): string {
  return JSON.stringify({
    at: Math.floor(Date.now() / 1000),
    reason,
  });
}

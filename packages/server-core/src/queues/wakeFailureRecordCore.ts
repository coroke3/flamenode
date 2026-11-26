import type { KvPort } from "../ports.ts";
import type { QueueWakeKind } from "./wakeBudget.ts";

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
  kv: Pick<KvPort, "put">;
  reason: string;
  attemptedAt: number;
};

// QueueWakeKind is a fixed, bounded set, so this map cannot grow with input.
const recentFailureWrites = new Map<string, FailureWriteState>();

function warnBestEffortDiagnostic(payload: {
  service: string;
  result: "last_failure_record_skipped" | "last_failure_record_failed";
  kind: QueueWakeKind;
  reason: string;
}): void {
  try {
    console.warn(JSON.stringify(payload));
  } catch {
    // Diagnostic-only sink failure must never abort best-effort wake recording.
  }
}

/**
 * last-failure 記録の共有実装（best-effort）。
 * server 側と worker 側の wrapper から service 名だけ変えて呼ばれる。
 */
export async function recordQueueWakeFailureBestEffortCore(
  service: string,
  input: {
    kind: QueueWakeKind;
    reason: string;
    kv: Pick<KvPort, "put"> | null;
  },
): Promise<void> {
  const kv = input.kv;
  // Even probing a Worker KV binding can throw when a host shim exposes a
  // poisoned accessor/Proxy. This is diagnostics only, never part of the
  // committed mutation's success contract.
  let put: Pick<KvPort, "put">["put"] | null = null;
  try {
    if (kv) {
      const candidate = kv.put;
      if (typeof candidate === "function") put = candidate;
    }
  } catch {
    // No provider Error object, name or cause may be logged from this path.
  }

  if (!kv || !put) {
    warnBestEffortDiagnostic({
      service,
      result: "last_failure_record_skipped",
      kind: input.kind,
      reason: input.reason,
    });
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
    // Invoke the already validated function; do not read the dynamic getter
    // a second time, and preserve method receivers required by real KV shims.
    await put.call(kv, queueWakeLastFailureKvKey(input.kind), serializeQueueWakeLastFailure(input.reason), {
      expirationTtl: QUEUE_WAKE_LAST_FAILURE_TTL_SECONDS,
    });
  } catch {
    // Error.name is not a trusted enum: a provider can put arbitrary secret
    // text in it. Report only fixed status and the caller's bounded reason.
    warnBestEffortDiagnostic({
      service,
      result: "last_failure_record_failed",
      kind: input.kind,
      reason: input.reason,
    });
  }
}

export function resetQueueWakeFailureRecordStateForTests(): void {
  recentFailureWrites.clear();
}

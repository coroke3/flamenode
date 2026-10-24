import {
  QUEUE_FREE_TIER_BUDGET,
  QUEUE_WAKE_KINDS,
  QUEUE_WAKE_MESSAGE_VERSION,
  QUEUE_WAKE_SOURCES,
  type QueueWakeKind,
  type QueueWakeMessage,
  type QueueWakeSource,
} from "./wakeBudget.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createQueueWakeMessage(input: {
  kind: QueueWakeKind;
  source: QueueWakeSource;
  requestedAt?: number;
  traceId?: string;
}): QueueWakeMessage {
  const requested_at =
    typeof input.requestedAt === "number" && Number.isFinite(input.requestedAt)
      ? Math.floor(input.requestedAt)
      : Math.floor(Date.now() / 1000);
  const trace_id =
    input.traceId?.trim() ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `trace_${requested_at}`);

  return {
    version: QUEUE_WAKE_MESSAGE_VERSION,
    kind: input.kind,
    source: input.source,
    requested_at,
    trace_id: trace_id.slice(0, 64),
  };
}

export function parseQueueWakeMessage(
  value: unknown,
  expectedKind?: QueueWakeKind,
): QueueWakeMessage | null {
  if (!isRecord(value)) return null;
  if (value.version !== QUEUE_WAKE_MESSAGE_VERSION) return null;
  if (
    typeof value.kind !== "string" ||
    !QUEUE_WAKE_KINDS.includes(value.kind as QueueWakeKind)
  ) {
    return null;
  }
  if (expectedKind && value.kind !== expectedKind) return null;
  if (
    typeof value.source !== "string" ||
    !QUEUE_WAKE_SOURCES.includes(value.source as QueueWakeSource)
  ) {
    return null;
  }
  if (
    typeof value.requested_at !== "number" ||
    !Number.isFinite(value.requested_at)
  ) {
    return null;
  }
  if (typeof value.trace_id !== "string" || value.trace_id.length === 0) {
    return null;
  }

  const message: QueueWakeMessage = {
    version: QUEUE_WAKE_MESSAGE_VERSION,
    kind: value.kind as QueueWakeKind,
    source: value.source as QueueWakeSource,
    requested_at: Math.floor(value.requested_at),
    trace_id: value.trace_id.slice(0, 64),
  };

  // Reject payloads that accidentally include business fields.
  const allowed = new Set([
    "version",
    "kind",
    "source",
    "requested_at",
    "trace_id",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return null;
  }

  return message;
}

export function estimateQueueWakeMessageBytes(
  message: QueueWakeMessage,
): number {
  return new TextEncoder().encode(JSON.stringify(message)).length;
}

export function assertQueueWakeMessageWithinBudget(
  message: QueueWakeMessage,
): void {
  const bytes = estimateQueueWakeMessageBytes(message);
  if (bytes >= QUEUE_FREE_TIER_BUDGET.maxMessageBytes) {
    throw new Error(`queue_wake_message_too_large:${bytes}`);
  }
}

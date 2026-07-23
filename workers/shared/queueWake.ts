/**
 * Worker 側 Queue wake 共通処理（OpenNext server-only に依存しない）。
 */

import {
  QUEUE_FEATURE_FLAG_NAMES,
  QUEUE_FREE_TIER_BUDGET,
  type QueueWakeKind,
  type QueueWakeMessage,
  type QueueWakeSource,
} from "../../src/lib/queues/wakeBudget.ts";
import {
  assertQueueWakeMessageWithinBudget,
  createQueueWakeMessage,
  parseQueueWakeMessage,
} from "../../src/lib/queues/wakeMessage.ts";
import { resolveQueueFeatureFlags } from "../../src/lib/queues/featureFlags.ts";
import { recordQueueWakeFailureBestEffort } from "./queueWakeFailure.ts";

export {
  QUEUE_FEATURE_FLAG_NAMES,
  QUEUE_FREE_TIER_BUDGET,
  createQueueWakeMessage,
  parseQueueWakeMessage,
  assertQueueWakeMessageWithinBudget,
  resolveQueueFeatureFlags,
};
export type { QueueWakeKind, QueueWakeMessage, QueueWakeSource };

export type WorkerQueueSendBinding = {
  send: (body: unknown) => Promise<void>;
};

export type QueueConsumerResult = {
  /** Queue メッセージ全体を retry する（インフラ障害時のみ） */
  retryBatch: boolean;
  continued: boolean;
  processed: number;
  skipped: number;
  failed: number;
};

const missingWarned = new Set<string>();

function warnOnce(key: string, payload: Record<string, unknown>): void {
  if (missingWarned.has(key)) return;
  missingWarned.add(key);
  console.warn(JSON.stringify(payload));
}

export function extractValidatedWakeFromBatch(
  batch: MessageBatch<unknown>,
  expectedKind: QueueWakeKind,
): { messages: Message<unknown>[]; wake: QueueWakeMessage | null } {
  const messages = [...batch.messages];
  let wake: QueueWakeMessage | null = null;
  for (const message of messages) {
    const parsed = parseQueueWakeMessage(message.body, expectedKind);
    if (parsed && !wake) wake = parsed;
  }
  return { messages, wake };
}

/**
 * Consumer / Recovery から継続 wake を best-effort 送信する。
 * 失敗しても業務処理は成功扱い。
 */
export async function sendWorkerQueueWakeBestEffort(input: {
  queue: WorkerQueueSendBinding | null | undefined;
  kind: QueueWakeKind;
  source: QueueWakeSource;
  envFlags?: Record<string, string | undefined> | null;
  requireYoutubeFlag?: boolean;
  /** 同一処理内の重複防止用。呼び出し側が Set を共有する。 */
  sentKinds?: Set<QueueWakeKind>;
  kv?: KVNamespace | null;
}): Promise<boolean> {
  const flags = resolveQueueFeatureFlags(input.envFlags ?? null);
  if (!flags.dispatchEnabled) return false;
  if (input.source === "continuation" && !flags.continuationEnabled) {
    return false;
  }
  if (input.requireYoutubeFlag && !flags.youtubeSyncEnabled) return false;
  if (input.sentKinds?.has(input.kind)) return false;
  if (!input.queue) {
    warnOnce(`worker_wake_missing:${input.kind}`, {
      service: "queue-wake-worker",
      result: "binding_missing",
      kind: input.kind,
    });
    void recordQueueWakeFailureBestEffort({
      kind: input.kind,
      reason: "binding_missing",
      kv: input.kv,
    });
    return false;
  }

  const message = createQueueWakeMessage({
    kind: input.kind,
    source: input.source,
  });
  try {
    assertQueueWakeMessageWithinBudget(message);
  } catch {
    return false;
  }

  input.sentKinds?.add(input.kind);

  try {
    await input.queue.send(message);
    return true;
  } catch (error) {
    warnOnce(`worker_wake_send_failed:${input.kind}`, {
      service: "queue-wake-worker",
      result: "send_failed",
      kind: input.kind,
      error_name: error instanceof Error ? error.name : undefined,
    });
    void recordQueueWakeFailureBestEffort({
      kind: input.kind,
      reason: "send_failed",
      kv: input.kv,
    });
    return false;
  }
}

export function ackAll(messages: Message<unknown>[]): void {
  for (const message of messages) {
    message.ack();
  }
}

export function retryAll(messages: Message<unknown>[]): void {
  for (const message of messages) {
    message.retry();
  }
}

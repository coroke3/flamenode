import "server-only";

import { sendQueueWakeBestEffort, type QueueSendBinding } from "./sendQueueWakeBestEffort";
import type { QueueWakeKind, QueueWakeSource } from "./wakeBudget";

const STATIC_REBUILD_WAKE_KIND: QueueWakeKind = "static_rebuild_available";

/**
 * static_rebuild_queue 保存の D1 batch / トランザクション成功後にだけ呼ぶ。
 * 同一 HTTP リクエスト内では sentKinds を共有して kind ごと最大1回にする。
 */
export async function wakeStaticRebuildQueueAfterCommit(
  source: QueueWakeSource,
  options?: {
    sentKinds?: Set<QueueWakeKind>;
    queue?: QueueSendBinding | null;
    envFlags?: Record<string, string | undefined> | null;
  },
): Promise<{ sent: boolean; reason?: string }> {
  return sendQueueWakeBestEffort({
    kind: STATIC_REBUILD_WAKE_KIND,
    source,
    sentKinds: options?.sentKinds,
    queue: options?.queue,
    envFlags: options?.envFlags,
  });
}

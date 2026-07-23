import "server-only";

import { sendQueueWakeBestEffort } from "./sendQueueWakeBestEffort.ts";
import type { QueueWakeKind, QueueWakeSource } from "./wakeBudget.ts";

const NOTIFICATION_WAKE_KIND: QueueWakeKind = "notification_available";

/**
 * notification_outbox 保存の D1 batch / トランザクション成功後にだけ呼ぶ。
 * 同一 HTTP リクエスト内では sentKinds を共有して kind ごと最大1回にする。
 */
export async function wakeNotificationQueueAfterCommit(
  source: QueueWakeSource,
  options?: {
    sentKinds?: Set<QueueWakeKind>;
  },
): Promise<{ sent: boolean; reason?: string }> {
  return sendQueueWakeBestEffort({
    kind: NOTIFICATION_WAKE_KIND,
    source,
    sentKinds: options?.sentKinds,
  });
}

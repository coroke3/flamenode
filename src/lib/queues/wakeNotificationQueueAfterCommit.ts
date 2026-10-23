// Compatibility bridge (MIG-0613, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import { wakeNotificationQueueAfterCommit as wakeNotificationQueueAfterCommitCore } from "@flamenode/server-core/queues/wakeNotificationQueueAfterCommit";
import type { QueueWakeKind, QueueWakeSource } from "@flamenode/server-core/queues/wakeBudget";

/**
 * notification_outbox 保存の D1 batch / トランザクション成功後にだけ呼ぶ。
 * 同一 HTTP リクエスト内では sentKinds を共有して kind ごと最大1回にする。
 */
export function wakeNotificationQueueAfterCommit(
  source: QueueWakeSource,
  options?: {
    sentKinds?: Set<QueueWakeKind>;
  },
): Promise<{ sent: boolean; reason?: string }> {
  return wakeNotificationQueueAfterCommitCore(source, options, nextQueueWakeHost);
}

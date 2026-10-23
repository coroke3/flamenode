// Compatibility bridge (MIG-0613, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import type { QueueFeatureFlagEnv } from "@flamenode/server-core/queues/featureFlags";
import type { QueueSendBinding } from "@flamenode/server-core/queues/sendQueueWakeBestEffort";
import { wakeStaticRebuildQueueAfterCommit as wakeStaticRebuildQueueAfterCommitCore } from "@flamenode/server-core/queues/wakeStaticRebuildQueueAfterCommit";
import type { QueueWakeKind, QueueWakeSource } from "@flamenode/server-core/queues/wakeBudget";

/**
 * static_rebuild_queue 保存の D1 batch / トランザクション成功後にだけ呼ぶ。
 * 同一 HTTP リクエスト内では sentKinds を共有して kind ごと最大1回にする。
 */
export function wakeStaticRebuildQueueAfterCommit(
  source: QueueWakeSource,
  options?: {
    sentKinds?: Set<QueueWakeKind>;
    queue?: QueueSendBinding | null;
    envFlags?: QueueFeatureFlagEnv | null;
  },
): Promise<{ sent: boolean; reason?: string }> {
  return wakeStaticRebuildQueueAfterCommitCore(source, options, nextQueueWakeHost);
}

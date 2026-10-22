// Compatibility bridge (MIG-0613, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import type { QueueWakeKind, QueueWakeSource } from "@flamenode/server-core/queues/wakeBudget";
import { sendYoutubeSyncPendingWakeBestEffort as sendYoutubeSyncPendingWakeBestEffortCore } from "@flamenode/server-core/queues/youtubeSyncWake";

/** YouTube pending metadata 作成後に最大1件の wake を送る。 */
export function sendYoutubeSyncPendingWakeBestEffort(
  source: QueueWakeSource,
  sentKinds?: Set<QueueWakeKind>,
): Promise<{ sent: boolean; reason?: string }> {
  return sendYoutubeSyncPendingWakeBestEffortCore(source, sentKinds, nextQueueWakeHost);
}

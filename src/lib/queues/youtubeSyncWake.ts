import "server-only";

import { sendQueueWakeBestEffort } from "./sendQueueWakeBestEffort";
import type { QueueWakeKind, QueueWakeSource } from "./wakeBudget";

/** YouTube pending metadata 作成後に最大1件の wake を送る。 */
export async function sendYoutubeSyncPendingWakeBestEffort(
  source: QueueWakeSource,
  sentKinds?: Set<QueueWakeKind>,
): Promise<{ sent: boolean; reason?: string }> {
  return sendQueueWakeBestEffort({
    kind: "youtube_sync_pending",
    source,
    requireYoutubeFlag: true,
    sentKinds,
  });
}

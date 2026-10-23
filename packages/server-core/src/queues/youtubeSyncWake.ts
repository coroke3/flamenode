import type { QueueWakeHost } from "../ports.ts";
import { sendQueueWakeBestEffort } from "./sendQueueWakeBestEffort.ts";
import type { QueueWakeKind, QueueWakeSource } from "./wakeBudget.ts";

/** YouTube pending metadata 作成後に最大1件の wake を送る。 */
export async function sendYoutubeSyncPendingWakeBestEffort(
  source: QueueWakeSource,
  sentKinds: Set<QueueWakeKind> | undefined,
  host: QueueWakeHost,
): Promise<{ sent: boolean; reason?: string }> {
  return sendQueueWakeBestEffort(
    {
      kind: "youtube_sync_pending",
      source,
      requireYoutubeFlag: true,
      sentKinds,
    },
    host,
  );
}

import "server-only";

import { sendQueueWakeBestEffort } from "./sendQueueWakeBestEffort";
import type { QueueWakeKind, QueueWakeSource } from "./wakeBudget";

/**
 * イベント再生リスト設定/手動予約のcommit後に、同じYouTube Queueへドアベルを送る。
 * Queue無効・送信失敗時もD1のnext_sync_atが正本なので :52 Cronがフォールバックする。
 */
export async function sendYoutubePlaylistSyncWakeBestEffort(
  source: QueueWakeSource,
  sentKinds?: Set<QueueWakeKind>,
): Promise<{ sent: boolean; reason?: string }> {
  return sendQueueWakeBestEffort({
    kind: "youtube_playlist_sync",
    source,
    requireYoutubeFlag: true,
    sentKinds,
  });
}

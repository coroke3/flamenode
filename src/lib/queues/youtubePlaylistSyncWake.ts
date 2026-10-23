// Compatibility bridge (MIG-0613, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import type { QueueWakeKind, QueueWakeSource } from "@flamenode/server-core/queues/wakeBudget";
import { sendYoutubePlaylistSyncWakeBestEffort as sendYoutubePlaylistSyncWakeBestEffortCore } from "@flamenode/server-core/queues/youtubePlaylistSyncWake";

/**
 * イベント再生リスト設定/手動予約のcommit後に、同じYouTube Queueへドアベルを送る。
 * Queue無効・送信失敗時もD1のnext_sync_atが正本なので :52 Cronがフォールバックする。
 */
export function sendYoutubePlaylistSyncWakeBestEffort(
  source: QueueWakeSource,
  sentKinds?: Set<QueueWakeKind>,
): Promise<{ sent: boolean; reason?: string }> {
  return sendYoutubePlaylistSyncWakeBestEffortCore(source, sentKinds, nextQueueWakeHost);
}

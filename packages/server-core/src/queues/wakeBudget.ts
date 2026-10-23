/**
 * Cloudflare Queues wake budget / schema の正本。
 * 業務データは載せない。D1 が処理正本、Queue はドアベルのみ。
 */

export const QUEUE_WAKE_MESSAGE_VERSION = 1 as const;

export const QUEUE_WAKE_KINDS = [
  "notification_available",
  "static_rebuild_available",
  "youtube_sync_pending",
  "youtube_playlist_sync",
] as const;

export type QueueWakeKind = (typeof QUEUE_WAKE_KINDS)[number];

export const QUEUE_WAKE_SOURCES = [
  "web",
  "admin",
  "manage",
  "sync",
  "import",
  "recovery",
  "continuation",
] as const;

export type QueueWakeSource = (typeof QUEUE_WAKE_SOURCES)[number];

export type QueueWakeMessage = {
  version: typeof QUEUE_WAKE_MESSAGE_VERSION;
  kind: QueueWakeKind;
  source: QueueWakeSource;
  requested_at: number;
  trace_id: string;
};

/** Free 枠の内部運用上限（通常日）。 */
export const QUEUE_FREE_TIER_BUDGET = Object.freeze({
  /** 正常配送メッセージの設計目標（全 Queue 合計） */
  maxNormalMessagesPerDay: 2_000,
  /** Queue operations の通常目標（send+receive+ack 想定） */
  maxNormalOperationsPerDay: 6_000,
  /** 再試行・DLQ・突発用の余裕 */
  reservedOperationsPerDay: 4_000,
  /** 1 メッセージの上限（バイト） */
  maxMessageBytes: 1_024,
  /** Consumer 同時実行 */
  maxConcurrency: 1,
  /** 1 Consumer invocation からの継続 wake 上限 */
  maxContinuationPerInvocation: 1,
  /** 通知 1 drain の上限 */
  notificationBatchSize: 6,
  /** 静的再生成 1 invocation のターゲット数 */
  staticRebuildTargetsPerInvocation: 1,
  /** YouTube pending 1 drain の最大動画数 */
  youtubePendingBatchSize: 50,
  /** YouTube API batch 上限（1 invocation） */
  youtubeApiBatchesPerInvocation: 1,
} as const);

export const QUEUE_BINDING_NAMES = Object.freeze({
  notificationWake: "NOTIFICATION_WAKE_QUEUE",
  staticRebuildWake: "STATIC_REBUILD_WAKE_QUEUE",
  youtubeSyncWake: "YOUTUBE_SYNC_WAKE_QUEUE",
} as const);

export const QUEUE_NAMES = Object.freeze({
  notificationWake: "flamenode-notification-wake",
  notificationDlq: "flamenode-notification-dlq",
  staticRebuildWake: "flamenode-static-rebuild-wake",
  staticRebuildDlq: "flamenode-static-rebuild-dlq",
  youtubeSyncWake: "flamenode-youtube-sync-wake",
  youtubeSyncDlq: "flamenode-youtube-sync-dlq",
} as const);

export const QUEUE_FEATURE_FLAG_NAMES = Object.freeze({
  dispatch: "QUEUE_DISPATCH_ENABLED",
  continuation: "QUEUE_CONTINUATION_ENABLED",
  youtubeSync: "QUEUE_YOUTUBE_SYNC_ENABLED",
} as const);

export function kindToBindingName(kind: QueueWakeKind): string {
  switch (kind) {
    case "notification_available":
      return QUEUE_BINDING_NAMES.notificationWake;
    case "static_rebuild_available":
      return QUEUE_BINDING_NAMES.staticRebuildWake;
    case "youtube_sync_pending":
    case "youtube_playlist_sync":
      return QUEUE_BINDING_NAMES.youtubeSyncWake;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

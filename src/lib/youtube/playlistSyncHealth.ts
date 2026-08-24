export type PlaylistSyncHealthLevel =
  | "ok"
  | "warn"
  | "critical"
  | "unknown"
  | "running";

export type PlaylistSyncHealthReason =
  | "disabled"
  | "failed"
  | "deferred"
  | "scanning"
  | "overdue"
  | "missing_schedule"
  | "never_synced"
  | "never_full_scan"
  | "out_of_sync"
  | "last_error"
  | "healthy"
  | "unknown_status";

export type PlaylistSyncHealthInput = {
  enabled: boolean | number;
  syncStatus: string | null;
  nextSyncAt: number | null;
  lastSyncedAt: number | null;
  lastFullScanAt: number | null;
  lastError: string | null;
  eligibleCount: number;
  syncedCount: number;
  linkedCount: number;
  now: number;
};

export type PlaylistSyncHealth = {
  level: PlaylistSyncHealthLevel;
  reason: PlaylistSyncHealthReason;
  priority: number;
};

export const PLAYLIST_SYNC_HEALTH_PRIORITY = Object.freeze({
  critical: 0,
  warn: 1,
  running: 2,
  unknown: 3,
  ok: 4,
} satisfies Record<PlaylistSyncHealthLevel, number>);

/**
 * Queue停止時も毎時52分のRecovery Cronで回収するため、due直後は異常にしない。
 * Cronを2回連続で越えた行だけをoverdueとして扱う。
 */
export const PLAYLIST_SYNC_OVERDUE_GRACE_SEC = 2 * 60 * 60;

function health(
  level: PlaylistSyncHealthLevel,
  reason: PlaylistSyncHealthReason,
): PlaylistSyncHealth {
  return { level, reason, priority: PLAYLIST_SYNC_HEALTH_PRIORITY[level] };
}

function finiteUnix(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : null;
}

function finiteCount(value: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/**
 * Admin / manage表示で共有する再生リスト同期の純粋なhealth判定。
 * DB query、現在時刻の取得、表示文言は呼出し側に残し、reason codeだけを正本化する。
 */
export function derivePlaylistSyncHealth(
  input: PlaylistSyncHealthInput,
): PlaylistSyncHealth {
  const enabled = input.enabled === true || input.enabled === 1;
  if (!enabled) return health("ok", "disabled");

  const status = input.syncStatus?.trim() ?? "";
  if (status === "failed") return health("critical", "failed");
  if (status === "deferred") return health("warn", "deferred");
  if (status === "scanning") return health("running", "scanning");
  if (!new Set(["idle", "synced"]).has(status)) {
    return health("unknown", "unknown_status");
  }

  const now = finiteUnix(input.now);
  const nextSyncAt = finiteUnix(input.nextSyncAt);
  const lastSyncedAt = finiteUnix(input.lastSyncedAt);
  const lastFullScanAt = finiteUnix(input.lastFullScanAt);
  const linkedCount = finiteCount(input.linkedCount);
  const eligibleCount = finiteCount(input.eligibleCount);
  const syncedCount = finiteCount(input.syncedCount);
  if (
    now == null ||
    linkedCount == null ||
    eligibleCount == null ||
    syncedCount == null
  ) {
    return health("unknown", "unknown_status");
  }

  if (lastSyncedAt == null) return health("warn", "never_synced");
  if (lastFullScanAt == null) return health("warn", "never_full_scan");
  if (nextSyncAt == null) return health("warn", "missing_schedule");
  if (eligibleCount !== syncedCount || eligibleCount > linkedCount) {
    return health("warn", "out_of_sync");
  }
  if (input.lastError?.trim()) return health("warn", "last_error");
  if (nextSyncAt + PLAYLIST_SYNC_OVERDUE_GRACE_SEC <= now) {
    return health("warn", "overdue");
  }
  return health("ok", "healthy");
}

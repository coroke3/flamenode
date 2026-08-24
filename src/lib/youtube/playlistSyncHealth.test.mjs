import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYLIST_SYNC_HEALTH_PRIORITY,
  PLAYLIST_SYNC_OVERDUE_GRACE_SEC,
  derivePlaylistSyncHealth,
} from "./playlistSyncHealth.ts";

const NOW = 2_000_000;
const healthy = {
  enabled: 1,
  syncStatus: "synced",
  nextSyncAt: NOW + 60,
  lastSyncedAt: NOW - 60,
  lastFullScanAt: NOW - 60,
  lastError: null,
  eligibleCount: 3,
  syncedCount: 3,
  linkedCount: 3,
  now: NOW,
};

test("health priorityはcriticalからokまで固定順にする", () => {
  assert.deepEqual(PLAYLIST_SYNC_HEALTH_PRIORITY, {
    critical: 0,
    warn: 1,
    running: 2,
    unknown: 3,
    ok: 4,
  });
});

test("無効な設定は対象外としてokを返す", () => {
  assert.deepEqual(
    derivePlaylistSyncHealth({
      ...healthy,
      enabled: 0,
      syncStatus: "failed",
      lastError: "ignored",
    }),
    { level: "ok", reason: "disabled", priority: 4 },
  );
});

test("failed/deferred/scanningは運用上の重要度へ直接写像する", () => {
  assert.deepEqual(
    derivePlaylistSyncHealth({ ...healthy, syncStatus: "failed" }),
    { level: "critical", reason: "failed", priority: 0 },
  );
  assert.deepEqual(
    derivePlaylistSyncHealth({ ...healthy, syncStatus: "deferred" }),
    { level: "warn", reason: "deferred", priority: 1 },
  );
  assert.deepEqual(
    derivePlaylistSyncHealth({ ...healthy, syncStatus: "scanning" }),
    { level: "running", reason: "scanning", priority: 2 },
  );
});

test("未同期・full scan未完了・schedule欠落を順に判定する", () => {
  assert.equal(
    derivePlaylistSyncHealth({ ...healthy, lastSyncedAt: null }).reason,
    "never_synced",
  );
  assert.equal(
    derivePlaylistSyncHealth({ ...healthy, lastFullScanAt: null }).reason,
    "never_full_scan",
  );
  assert.equal(
    derivePlaylistSyncHealth({ ...healthy, nextSyncAt: null }).reason,
    "missing_schedule",
  );
});

test("対象件数と保存済みitemの差をout_of_syncにする", () => {
  assert.deepEqual(
    derivePlaylistSyncHealth({ ...healthy, syncedCount: 2 }),
    { level: "warn", reason: "out_of_sync", priority: 1 },
  );
  assert.equal(
    derivePlaylistSyncHealth({ ...healthy, linkedCount: 2 }).reason,
    "out_of_sync",
  );
});

test("terminal warning codeをhealthyより優先する", () => {
  assert.deepEqual(
    derivePlaylistSyncHealth({
      ...healthy,
      lastError: "playlist_order_fallback_manual_sort_required",
    }),
    { level: "warn", reason: "last_error", priority: 1 },
  );
});

test("Recovery Cron 2回分の猶予を越えたdueだけをoverdueにする", () => {
  assert.equal(
    derivePlaylistSyncHealth({ ...healthy, nextSyncAt: NOW - 1 }).reason,
    "healthy",
  );
  assert.deepEqual(
    derivePlaylistSyncHealth({
      ...healthy,
      nextSyncAt: NOW - PLAYLIST_SYNC_OVERDUE_GRACE_SEC,
    }),
    { level: "warn", reason: "overdue", priority: 1 },
  );
});

test("未知statusや非有限入力はunknownへfail-closedする", () => {
  assert.deepEqual(
    derivePlaylistSyncHealth({ ...healthy, syncStatus: "running" }),
    { level: "unknown", reason: "unknown_status", priority: 3 },
  );
  assert.equal(
    derivePlaylistSyncHealth({ ...healthy, eligibleCount: Number.NaN }).level,
    "unknown",
  );
  assert.equal(
    derivePlaylistSyncHealth({ ...healthy, now: Number.POSITIVE_INFINITY }).level,
    "unknown",
  );
});

test("整合済みで猶予内ならhealthyを返す", () => {
  assert.deepEqual(derivePlaylistSyncHealth(healthy), {
    level: "ok",
    reason: "healthy",
    priority: 4,
  });
});

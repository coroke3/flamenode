import { Hono } from "hono";
import type { ManagePlaylistResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn, resolveActiveXUserId } from "../personal/context.ts";
import { canEditEvent, loadManageSnapshot, manageGate } from "./access.ts";
import type { ManageLinkedX } from "./events.ts";

// CURRENT: app/(manage)/manage/events/[id]/youtube-playlist/page.tsx + src/lib/youtube/playlistSyncHealth.ts.
// Authorization (CURRENT): admin or the event is in the caller's manageable ids, and the event exists (else 404);
// `canEdit` = event.publish. D1 (S2, <= 3 statements incl. the session lookup): staff snapshot, then one statement.
const MAX_LINKED_X = 100;
/** CURRENT PLAYLIST_SYNC_OVERDUE_GRACE_SEC. */
const OVERDUE_GRACE_SEC = 2 * 60 * 60;
const PRIORITY: Record<string, number> = { critical: 0, warn: 1, running: 2, unknown: 3, ok: 4 };

interface Health {
  level: string;
  reason: string;
  priority: number;
}

const health = (level: string, reason: string): Health => ({ level, reason, priority: PRIORITY[level] ?? 3 });
const finiteUnix = (v: number | null): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : null);
const finiteCount = (v: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** CURRENT derivePlaylistSyncHealth. */
export function derivePlaylistSyncHealth(input: {
  enabled: number;
  syncStatus: string | null;
  nextSyncAt: number | null;
  lastSyncedAt: number | null;
  lastFullScanAt: number | null;
  lastError: string | null;
  eligibleCount: number;
  syncedCount: number;
  linkedCount: number;
  now: number;
}): Health {
  if (input.enabled !== 1) return health("ok", "disabled");
  const status = input.syncStatus?.trim() ?? "";
  if (status === "failed") return health("critical", "failed");
  if (status === "deferred") return health("warn", "deferred");
  if (status === "scanning") return health("running", "scanning");
  if (status !== "idle" && status !== "synced") return health("unknown", "unknown_status");
  const now = finiteUnix(input.now);
  const nextSyncAt = finiteUnix(input.nextSyncAt);
  const lastSyncedAt = finiteUnix(input.lastSyncedAt);
  const lastFullScanAt = finiteUnix(input.lastFullScanAt);
  const linkedCount = finiteCount(input.linkedCount);
  const eligibleCount = finiteCount(input.eligibleCount);
  const syncedCount = finiteCount(input.syncedCount);
  if (now == null || linkedCount == null || eligibleCount == null || syncedCount == null) {
    return health("unknown", "unknown_status");
  }
  if (lastSyncedAt == null) return health("warn", "never_synced");
  if (lastFullScanAt == null) return health("warn", "never_full_scan");
  if (nextSyncAt == null) return health("warn", "missing_schedule");
  if (eligibleCount !== syncedCount || eligibleCount > linkedCount) return health("warn", "out_of_sync");
  if (input.lastError?.trim()) return health("warn", "last_error");
  if (nextSyncAt + OVERDUE_GRACE_SEC <= now) return health("warn", "overdue");
  return health("ok", "healthy");
}

export const managePlaylistRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventId = c.req.param("id") ?? "";
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  if (!snapshot.isAdmin && !snapshot.manageableEventIds.includes(eventId)) return c.json({ error: "Not Found" }, 404);

  const row = await db
    .prepare(
      `SELECT e.id AS id, e.title AS title, e.accent_color AS accent_color,
         (SELECT COUNT(*) FROM video_events ve INNER JOIN videos v ON v.id = ve.video_id
           WHERE ve.event_id = ? AND v.visibility_status = 'pending') AS pending_count,
         (SELECT json_object('playlist_id', s.playlist_id, 'enabled', s.enabled, 'sync_mode', s.sync_mode,
              'sync_interval_minutes', s.sync_interval_minutes, 'sync_status', s.sync_status, 'next_sync_at', s.next_sync_at,
              'last_synced_at', s.last_synced_at, 'last_full_scan_at', s.last_full_scan_at, 'last_error', s.last_error)
            FROM event_youtube_playlist_sync s WHERE s.event_id = ? LIMIT 1) AS config,
         (SELECT json_object(
              'linked', COUNT(DISTINCT CASE WHEN v.id IS NOT NULL AND v.visibility_status <> 'voided' THEN v.id END),
              'eligible', COUNT(DISTINCT CASE WHEN v.visibility_status = 'public' AND v.youtube_video_id IS NOT NULL AND v.youtube_video_id <> '' THEN v.id END),
              'synced', COUNT(DISTINCT CASE WHEN i.playlist_item_id IS NOT NULL AND v.visibility_status = 'public' THEN v.id END))
            FROM video_events ve
            LEFT JOIN videos v ON v.id = ve.video_id
            LEFT JOIN event_youtube_playlist_items i ON i.event_id = ve.event_id AND i.youtube_video_id = v.youtube_video_id
            WHERE ve.event_id = ?) AS counts,
         (SELECT json_group_array(json_object('x_user_id', q.x_user_id, 'approval_status', q.approval_status)) FROM (
            SELECT x_users.id AS x_user_id, x_users.approval_status AS approval_status
            FROM x_user_account_links INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
            WHERE x_user_account_links.auth_user_id = ? LIMIT ?) q) AS linked
       FROM events e WHERE e.id = ? LIMIT 1`,
    )
    .bind(eventId, eventId, eventId, user.id, MAX_LINKED_X, eventId)
    .first<{
      id: string;
      title: string;
      accent_color: string | null;
      pending_count: number;
      config: string | null;
      counts: string | null;
      linked: string | null;
    }>();
  if (!row) return c.json({ error: "Not Found" }, 404);

  const config = parseJsonColumn<NonNullable<ManagePlaylistResponse["config"]> | null>(row.config, null);
  const rawCounts = parseJsonColumn<{ linked: number; eligible: number; synced: number }>(row.counts, {
    linked: 0,
    eligible: 0,
    synced: 0,
  });
  const counts = {
    linked: Number(rawCounts.linked ?? 0),
    eligible: Number(rawCounts.eligible ?? 0),
    synced: Number(rawCounts.synced ?? 0),
  };
  const body: ManagePlaylistResponse = {
    isAdmin: snapshot.isAdmin,
    event: { id: row.id, title: row.title, accent_color: row.accent_color },
    pendingCount: Number(row.pending_count ?? 0),
    canEdit: canEditEvent(snapshot, eventId, "event.publish"),
    activeXUserId: resolveActiveXUserId(user.active_x_user_id, parseJsonColumn<ManageLinkedX[]>(row.linked, [])),
    manageStaffXUserIds: snapshot.manageStaffXUserIds,
    config,
    counts,
    syncHealth: derivePlaylistSyncHealth({
      enabled: config?.enabled ?? 0,
      syncStatus: config?.sync_status ?? "disabled",
      nextSyncAt: config?.next_sync_at ?? null,
      lastSyncedAt: config?.last_synced_at ?? null,
      lastFullScanAt: config?.last_full_scan_at ?? null,
      lastError: config?.last_error ?? null,
      eligibleCount: counts.eligible,
      syncedCount: counts.synced,
      linkedCount: counts.linked,
      now: Math.floor(Date.now() / 1000),
    }),
  };
  return c.json(body);
});

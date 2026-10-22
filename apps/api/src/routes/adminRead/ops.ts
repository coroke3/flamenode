import { Hono } from "hono";
import type {
  AdminCostGuardResponse,
  AdminNotificationsResponse,
  AdminTopResponse,
  AdminYoutubeSyncResponse,
} from "@flamenode/contracts";
import { resolveOperationMode } from "@flamenode/domain/admin";
import type { AppEnv } from "../../env.ts";

// MIG-0626 operations admin screens. No external service is called from this file (no Cloudflare / YouTube
// diagnostics); everything is bounded D1 row reads.

/** CURRENT notifications/page.tsx .limit(100) on the latest notifications. */
const MAX_NOTIFICATIONS = 100;
/** CURRENT notifications/page.tsx q filter: .trim().slice(0, 100). */
const MAX_NOTIFICATION_QUERY_CHARS = 100;
/** CURRENT cost-guard/page.tsx history .limit(20). */
const MAX_COST_GUARD_HISTORY = 20;
/** CURRENT youtube-sync/page.tsx LIMIT (it reads LIMIT + 1 to know hasMore). */
const MAX_YOUTUBE_SYNC_ROWS = 100;
/** CURRENT youtube-sync/page.tsx STALE_SECONDS. */
const YOUTUBE_SYNC_STALE_SECONDS = 14 * 24 * 60 * 60;
/** ZERO_1102 S2: keep each list response under 64 KiB (payloads / errors are the large columns). */
const MAX_OPS_LIST_BYTES = 48 * 1024;

const TERMINAL_FAILURE_STATUSES = ["failed", "dead_letter"];
const NOTIFICATION_STATUSES = ["pending", "processing", "sent", "failed", "cancelled"];
const NOTIFICATION_CATEGORIES = [
  "all",
  "video",
  "slot",
  "x_id",
  "chapter",
  "moderation",
  "announcement",
  "event",
  "system",
  "unknown",
];

/** CURRENT drizzleNotificationCategoryCondition (src/lib/notifications/display.ts), column notification_outbox.type. */
function categoryCondition(category: string): string | null {
  switch (category) {
    case "video":
    case "slot":
    case "x_id":
    case "chapter":
    case "moderation":
    case "announcement":
    case "event":
      return "n.type LIKE '" + category + "_%'";
    case "system":
      return "n.type = 'discord_webhook'";
    case "unknown":
      return (
        "(n.type NOT LIKE 'video_%' AND n.type NOT LIKE 'slot_%' AND n.type NOT LIKE 'x_id_%' " +
        "AND n.type NOT LIKE 'chapter_%' AND n.type NOT LIKE 'moderation_%' AND n.type NOT LIKE 'announcement_%' " +
        "AND n.type NOT LIKE 'event_%' AND n.type != 'discord_webhook')"
      );
    default:
      return null;
  }
}

interface NotificationJoinRow {
  id: string;
  type: string;
  status: string | null;
  payload_json: string;
  event_id: string | null;
  recipient_user_id: string | null;
  attempt_count: number | null;
  next_attempt_at: number | null;
  created_at: number;
  last_error: string | null;
  dedupe_key: string | null;
  r_id: string | null;
  r_discord_id: string | null;
  r_name: string | null;
  r_notifications_enabled: number | null;
}

export const adminOpsRoutes = new Hono<AppEnv>();

// ---- /ops/notifications (notifications/page.tsx) ----
// D1: session + list (recipient lookup joined in) + operational counts (incl. unhealthy leases) = 3 statements.
// CURRENT shows String(cause) when a query fails; this returns the fixed code "query_failed" instead.
adminOpsRoutes.get("/notifications", async (c) => {
  const statusQ = c.req.query("status") ?? "";
  const status = (NOTIFICATION_STATUSES.includes(statusQ) ? statusQ : "all") as AdminNotificationsResponse["status"];
  const typeFilter = (c.req.query("type") ?? "").trim();
  const eventFilter = (c.req.query("event") ?? "").trim();
  const qFilter = (c.req.query("q") ?? "").trim().slice(0, MAX_NOTIFICATION_QUERY_CHARS);
  const catQ = (c.req.query("cat") ?? "").trim();
  const category = NOTIFICATION_CATEGORIES.includes(catQ) ? catQ : "all";

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status === "failed") {
    conditions.push("n.status IN (" + TERMINAL_FAILURE_STATUSES.map(() => "?").join(", ") + ")");
    params.push(...TERMINAL_FAILURE_STATUSES);
  } else if (status !== "all") {
    conditions.push("n.status = ?");
    params.push(status);
  }
  if (typeFilter) {
    conditions.push("n.type = ?");
    params.push(typeFilter);
  }
  if (eventFilter) {
    conditions.push("n.event_id = ?");
    params.push(eventFilter);
  }
  if (qFilter) {
    conditions.push("n.payload_json LIKE ?");
    params.push("%" + qFilter + "%");
  }
  const categorySql = category === "all" ? null : categoryCondition(category);
  if (categorySql) conditions.push(categorySql);
  const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  const now = Math.floor(Date.now() / 1000);

  let rows: AdminNotificationsResponse["rows"] = [];
  let truncated = false;
  let counts: AdminNotificationsResponse["counts"] = {
    pending: 0,
    processing: 0,
    failed: 0,
    deadLetter: 0,
    unhealthyLease: 0,
  };
  let error: AdminNotificationsResponse["error"] = null;
  try {
    const [list, operational] = await Promise.all([
      c.env.DB.prepare(
        "SELECT n.id AS id, n.type AS type, n.status AS status, n.payload_json AS payload_json, n.event_id AS event_id, " +
          "n.recipient_user_id AS recipient_user_id, n.attempt_count AS attempt_count, n.next_attempt_at AS next_attempt_at, " +
          "n.created_at AS created_at, n.last_error AS last_error, n.dedupe_key AS dedupe_key, " +
          "u.id AS r_id, u.discord_id AS r_discord_id, u.name AS r_name, u.is_notification_enabled AS r_notifications_enabled " +
          'FROM notification_outbox n LEFT JOIN "user" u ON u.id = n.recipient_user_id' +
          where +
          " ORDER BY n.created_at DESC LIMIT ?",
      )
        .bind(...params, MAX_NOTIFICATIONS)
        .all<NotificationJoinRow>(),
      c.env.DB.prepare(
        "SELECT " +
          "SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, " +
          "SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing, " +
          "SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, " +
          "SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter, " +
          "(SELECT COUNT(*) FROM notification_outbox WHERE status = 'processing' " +
          "AND (lease_expires_at IS NULL OR lease_expires_at <= ?)) AS unhealthy " +
          "FROM notification_outbox WHERE status IN ('pending', 'processing', 'failed', 'dead_letter')",
      )
        .bind(now)
        .first<{
          pending: number | null;
          processing: number | null;
          failed: number | null;
          dead_letter: number | null;
          unhealthy: number | null;
        }>(),
    ]);
    counts = {
      pending: Number(operational?.pending ?? 0),
      processing: Number(operational?.processing ?? 0),
      failed: Number(operational?.failed ?? 0),
      deadLetter: Number(operational?.dead_letter ?? 0),
      unhealthyLease: Number(operational?.unhealthy ?? 0),
    };
    let used = 0;
    for (const row of list.results) {
      const { r_id, r_discord_id, r_name, r_notifications_enabled, ...rest } = row;
      const entry = {
        ...rest,
        recipient:
          r_id != null
            ? {
                userId: r_id,
                discordId: r_discord_id,
                userName: r_name,
                notificationsEnabled: r_notifications_enabled === 0 ? false : true,
              }
            : null,
      };
      const size = JSON.stringify(entry).length;
      if (rows.length > 0 && used + size > MAX_OPS_LIST_BYTES) {
        truncated = true;
        break;
      }
      used += size;
      rows.push(entry);
    }
  } catch {
    console.error("[adminRead] notifications query failed");
    rows = [];
    truncated = false;
    error = "query_failed";
  }

  const body: AdminNotificationsResponse = { status, category, truncated, error, counts, rows };
  return c.json(body);
});

// ---- /ops/top (admin/page.tsx; fetchAdminTopSnapshot in src/lib/admin/adminPendingCounts.ts) ----
// CURRENT runs 7 reads; here ONE statement of scalar subqueries (session + 1). A failure is swallowed like
// CURRENT's try/catch: empty counts, mode normal (200).
const EMPTY_TOP_COUNTS: AdminTopResponse["counts"] = {
  pendingVideos: 0,
  reservedOpenSlots: 0,
  xLinkRequests: 0,
  xMergeRequests: 0,
  xMergeReverts: 0,
  notificationFailed: 0,
  notificationStuck: 0,
  youtubeFailed: 0,
  moderationOpen: 0,
  moderationOverdue: 0,
};

adminOpsRoutes.get("/top", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const processingCutoff = now - 15 * 60;
  let body: AdminTopResponse = { counts: { ...EMPTY_TOP_COUNTS }, mode: "normal", isMaintenance: 0 };
  try {
    const row = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM videos WHERE visibility_status = 'pending') AS pending_videos,
         (SELECT COUNT(*) FROM slots INNER JOIN events ON events.id = slots.event_id
           WHERE slots.status = 'reserved' AND events.visibility_status = 'public'
             AND (events.entry_start_time IS NOT NULL OR events.entry_end_time IS NOT NULL)
             AND (events.entry_start_time IS NULL OR events.entry_start_time <= ?1)
             AND (events.entry_end_time IS NULL OR events.entry_end_time > ?1)
             AND (events.start_time IS NULL OR events.end_time IS NULL OR events.end_time > ?1)) AS reserved_open_slots,
         (SELECT SUM(CASE WHEN request_type IN ('new_link','existing_link','alias') THEN 1 ELSE 0 END)
           FROM x_identity_requests WHERE status = 'pending'
             AND request_type IN ('new_link','existing_link','alias','merge','revert_merge')) AS x_link_requests,
         (SELECT SUM(CASE WHEN request_type = 'merge' THEN 1 ELSE 0 END)
           FROM x_identity_requests WHERE status = 'pending'
             AND request_type IN ('new_link','existing_link','alias','merge','revert_merge')) AS x_merge_requests,
         (SELECT SUM(CASE WHEN request_type = 'revert_merge' THEN 1 ELSE 0 END)
           FROM x_identity_requests WHERE status = 'pending'
             AND request_type IN ('new_link','existing_link','alias','merge','revert_merge')) AS x_merge_reverts,
         (SELECT SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)
           FROM notification_outbox WHERE status IN ('failed','processing')) AS notification_failed,
         (SELECT SUM(CASE WHEN status = 'processing' AND processing_started_at < ?2 THEN 1 ELSE 0 END)
           FROM notification_outbox WHERE status IN ('failed','processing')) AS notification_stuck,
         (SELECT COUNT(*) FROM video_youtube_metadata WHERE sync_status = 'failed') AS youtube_failed,
         (SELECT SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)
           FROM video_moderation_cases WHERE status = 'open') AS moderation_open,
         (SELECT SUM(CASE WHEN status = 'open' AND due_at < ?1 THEN 1 ELSE 0 END)
           FROM video_moderation_cases WHERE status = 'open') AS moderation_overdue,
         (SELECT operation_mode FROM system_settings WHERE id = 'default' LIMIT 1) AS operation_mode`,
    )
      .bind(now, processingCutoff)
      .first<Record<string, number | string | null>>();
    const n = (key: string) => Number(row?.[key] ?? 0);
    const mode = resolveOperationMode({ operation_mode: (row?.operation_mode as string | null) ?? null });
    body = {
      counts: {
        pendingVideos: n("pending_videos"),
        reservedOpenSlots: n("reserved_open_slots"),
        xLinkRequests: n("x_link_requests"),
        xMergeRequests: n("x_merge_requests"),
        xMergeReverts: n("x_merge_reverts"),
        notificationFailed: n("notification_failed"),
        notificationStuck: n("notification_stuck"),
        youtubeFailed: n("youtube_failed"),
        moderationOpen: n("moderation_open"),
        moderationOverdue: n("moderation_overdue"),
      },
      mode,
      isMaintenance: mode === "maintenance" ? 1 : 0,
    };
  } catch {
    console.error("[adminRead] top snapshot failed");
  }
  return c.json(body);
});

// ---- /ops/cost-guard (cost-guard/page.tsx) ----
// D1: session + system_settings row + the 20 newest system_settings UPDATE audit rows = 3 statements.
// CURRENT swallows a failure of either read (console.error) and renders the defaults (mode normal, no history).
adminOpsRoutes.get("/cost-guard", async (c) => {
  let body: AdminCostGuardResponse = {
    mode: "normal",
    isMaintenance: false,
    reason: null,
    updatedAt: null,
    exceptionUntil: null,
    exceptionFeaturesJson: null,
    disabledFeaturesJson: null,
    truncated: false,
    history: [],
  };
  try {
    const settings = await c.env.DB.prepare(
      "SELECT operation_mode, disabled_features_json, cost_guard_reason, cost_guard_updated_at, cost_guard_exception_until, " +
        "cost_guard_exception_features_json FROM system_settings WHERE id = 'default' LIMIT 1",
    ).first<{
      operation_mode: string | null;
      disabled_features_json: string | null;
      cost_guard_reason: string | null;
      cost_guard_updated_at: number | null;
      cost_guard_exception_until: number | null;
      cost_guard_exception_features_json: string | null;
    }>();
    let mode = body.mode;
    let found = body;
    if (settings) {
      mode = resolveOperationMode({ operation_mode: settings.operation_mode });
      found = {
        ...body,
        mode,
        isMaintenance: mode === "maintenance",
        reason: settings.cost_guard_reason,
        updatedAt: settings.cost_guard_updated_at ?? null,
        exceptionUntil: settings.cost_guard_exception_until ?? null,
        exceptionFeaturesJson: settings.cost_guard_exception_features_json,
        disabledFeaturesJson: settings.disabled_features_json,
      };
    }
    const { results } = await c.env.DB.prepare(
      "SELECT id, created_at, actor_user_id, target_id, before_json, after_json FROM audit_logs " +
        "WHERE table_name = 'system_settings' AND operation = 'UPDATE' ORDER BY created_at DESC LIMIT ?",
    )
      .bind(MAX_COST_GUARD_HISTORY)
      .all<AdminCostGuardResponse["history"][number]>();
    // ZERO_1102 S2: response <= 64 KiB (before/after snapshots are the large columns).
    const history: AdminCostGuardResponse["history"] = [];
    let used = 0;
    let truncated = false;
    for (const row of results) {
      const size = JSON.stringify(row).length;
      if (history.length > 0 && used + size > MAX_OPS_LIST_BYTES) {
        truncated = true;
        break;
      }
      used += size;
      history.push(row);
    }
    body = { ...found, truncated, history };
  } catch {
    console.error("[adminRead] cost-guard read failed");
  }
  return c.json(body);
});

// ---- /ops/youtube-sync (youtube-sync/page.tsx) ----
const VISIBILITY_GROUPS: Record<string, readonly string[]> = {
  review: ["pending"],
  public: ["public"],
  private: ["private"],
  closed: ["voided"],
};
const VISIBILITY_STATUSES = ["pending", "public", "private", "voided"];

/** CURRENT normalizeVideoVisibilityFilter + videoVisibilityStatusesForFilter (src/lib/admin/videoVisibilityLabels.ts). */
function visibilityFilter(raw: string): { value: string; statuses: readonly string[] | null } {
  const value = raw.trim();
  if (!value || value === "all") return { value: "", statuses: null };
  if (value in VISIBILITY_GROUPS && Object.hasOwn(VISIBILITY_GROUPS, value)) {
    return { value, statuses: VISIBILITY_GROUPS[value] ?? null };
  }
  if (VISIBILITY_STATUSES.includes(value)) return { value, statuses: [value] };
  return { value: "", statuses: null };
}

adminOpsRoutes.get("/youtube-sync", async (c) => {
  const q = (name: string) => (c.req.query(name) ?? "").trim();
  const syncStatus = q("sync_status");
  const privacy = q("privacy");
  const availability = q("availability");
  const visibility = visibilityFilter(q("visibility"));
  const failedOnly = q("failed") === "1";
  const staleOnly = q("stale") === "1";
  const missingOnly = q("missing") === "1";
  const now = Math.floor(Date.now() / 1000);

  const conds: string[] = [];
  const params: unknown[] = [];
  if (syncStatus === "pending" || syncStatus === "synced" || syncStatus === "failed") {
    conds.push("m.sync_status = ?");
    params.push(syncStatus);
  }
  if (privacy) {
    conds.push("m.youtube_privacy_status = ?");
    params.push(privacy);
  }
  if (availability) {
    conds.push("m.youtube_availability_status = ?");
    params.push(availability);
  }
  if (visibility.statuses && visibility.statuses.length > 1) {
    conds.push("v.visibility_status IN (" + visibility.statuses.map(() => "?").join(", ") + ")");
    params.push(...visibility.statuses);
  } else if (visibility.statuses?.[0]) {
    conds.push("v.visibility_status = ?");
    params.push(visibility.statuses[0]);
  }
  if (failedOnly) conds.push("m.sync_status = 'failed'");
  if (staleOnly) {
    conds.push("(m.synced_at IS NULL OR m.synced_at < ?)");
    params.push(now - YOUTUBE_SYNC_STALE_SECONDS);
  }
  if (missingOnly) conds.push("(v.youtube_video_id IS NULL OR v.youtube_video_id = '')");
  const where = conds.length > 0 ? " WHERE " + conds.join(" AND ") : "";

  const { results } = await c.env.DB.prepare(
    "SELECT v.id AS video_id, v.title AS title, v.creator_display_name AS creator_name, " +
      "v.youtube_video_id AS youtube_video_id, v.visibility_status AS visibility_status, " +
      "m.youtube_privacy_status AS youtube_privacy_status, m.youtube_availability_status AS youtube_availability_status, " +
      "m.duration_seconds AS duration_seconds, m.view_count AS view_count, m.sync_status AS sync_status, " +
      "m.sync_error AS sync_error, m.synced_at AS synced_at, m.updated_at AS updated_at " +
      "FROM videos v LEFT JOIN video_youtube_metadata m ON m.video_id = v.id" +
      where +
      " ORDER BY COALESCE(m.updated_at, v.updated_at, v.created_at) DESC LIMIT ?",
  )
    .bind(...params, MAX_YOUTUBE_SYNC_ROWS + 1)
    .all<AdminYoutubeSyncResponse["rows"][number]>();

  const hasMore = results.length > MAX_YOUTUBE_SYNC_ROWS;
  const all = results.slice(0, MAX_YOUTUBE_SYNC_ROWS);
  const rows: AdminYoutubeSyncResponse["rows"] = [];
  let used = 0;
  let truncated = false;
  for (const row of all) {
    const size = JSON.stringify(row).length;
    if (rows.length > 0 && used + size > MAX_OPS_LIST_BYTES) {
      truncated = true;
      break;
    }
    used += size;
    rows.push(row);
  }
  const body: AdminYoutubeSyncResponse = {
    filters: {
      sync_status: syncStatus,
      privacy,
      availability,
      visibility: visibility.value,
      failed: failedOnly,
      stale: staleOnly,
      missing: missingOnly,
    },
    hasMore,
    truncated,
    rows,
  };
  return c.json(body);
});

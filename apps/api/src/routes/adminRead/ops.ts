import { Hono } from "hono";
import type {
  AdminCostGuardResponse,
  AdminHealthResponse,
  AdminIntegrityResponse,
  AdminNotificationsResponse,
  AdminSecurityResponse,
  AdminStaticBuildsResponse,
  AdminTopResponse,
  AdminWorkersResponse,
  AdminYoutubePlaylistsResponse,
  AdminYoutubeQuotaResponse,
  AdminYoutubeSyncResponse,
} from "@flamenode/contracts";
import { derivePlaylistSyncHealth } from "./playlistHealth.ts";
import { loadWorkerMonitoring } from "./workerMonitoring.ts";
import {
  STATIC_BACKFILL_KINDS,
  STATIC_BACKFILL_KV_KEY,
  createEmptyStaticBackfillState,
  parseStaticBackfillState,
  resolveOperationMode,
  type StaticBackfillKind,
} from "@flamenode/domain/admin";
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
const utf8Encoder = new TextEncoder();
/** Serialized size in UTF-8 bytes (not UTF-16 units). Lists apply it to every row, the first included. */
function utf8Size(value: unknown): number {
  return utf8Encoder.encode(JSON.stringify(value)).length;
}

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
      const size = utf8Size(entry);
      if (used + size > MAX_OPS_LIST_BYTES) {
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

// ---- /ops/health (health/page.tsx; src/lib/admin/healthChecks.ts runOperationalHealthChecks) ----
// Default view = the 5 operational checks, as ONE UNION ALL statement (session + 1; CURRENT 9 queries). A failure
// is CURRENT's page error (Promise.all rejects): error "query_failed", no results.
//
// STOP (recorded, not implemented): ?deep=1 / ?run=1 runs the 22-check runHealthChecks(), which scans whole tables
// (like_count drift loads every video with stored likes into JS, orphan joins, slot pairs). That cannot meet S2
// (<= 3 statements, bounded LIMIT, 7 ms) and is a background-job (B) / build-time report, not an API read.
// The API answers 501 for deep runs; the SPA must not link to it until that job exists.
adminOpsRoutes.get("/health", async (c) => {
  const statusQ = c.req.query("status");
  const status = statusQ === "warn" || statusQ === "info" || statusQ === "ok" ? statusQ : "all";
  if (c.req.query("deep") === "1" || c.req.query("run") === "1") {
    return c.json({ error: "deep_unsupported" }, 501);
  }
  const now = Math.floor(Date.now() / 1000);
  let results: AdminHealthResponse["results"] = [];
  let error: AdminHealthResponse["error"] = null;
  try {
    const { results: rows } = await c.env.DB.prepare(
      `SELECT 'system_settings_single_row' AS check_id, COUNT(*) AS total_count, NULL AS a, NULL AS b, NULL AS c FROM system_settings
       UNION ALL
       SELECT 'notification_processing_stuck', total_count, id, processing_started_at, NULL FROM (
         SELECT id, processing_started_at, COUNT(*) OVER() AS total_count FROM notification_outbox
          WHERE status = 'processing' AND processing_started_at IS NOT NULL AND processing_started_at < ?1
          ORDER BY processing_started_at LIMIT 10)
       UNION ALL
       SELECT 'notification_failed_volume', total_count, id, type, NULL FROM (
         SELECT id, type, COUNT(*) OVER() AS total_count FROM notification_outbox
          WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10)
       UNION ALL
       SELECT 'open_moderation_cases_overdue', total_count, id, video_id, NULL FROM (
         SELECT id, video_id, COUNT(*) OVER() AS total_count FROM video_moderation_cases
          WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ?2 ORDER BY due_at LIMIT 10)
       UNION ALL
       SELECT 'x_id_merge_pending_stale', total_count, id, source_x_user_id, target_x_user_id FROM (
         SELECT id, source_x_user_id, target_x_user_id, COUNT(*) OVER() AS total_count FROM x_identity_requests
          WHERE request_type = 'merge' AND status = 'pending' AND requested_at < ?3 ORDER BY requested_at LIMIT 10)`,
    )
      .bind(now - 15 * 60, now, now - 7 * 86400)
      .all<{ check_id: string; total_count: number | null; a: string | null; b: string | number | null; c: string | null }>();
    const of = (id: string) => rows.filter((row) => row.check_id === id);
    const count = (id: string) => Number(of(id)[0]?.total_count ?? 0);
    const samples = (id: string, fn: (r: (typeof rows)[number]) => string) => of(id).slice(0, 5).map(fn);
    const stuck = count("notification_processing_stuck");
    const failed = count("notification_failed_volume");
    const overdue = count("open_moderation_cases_overdue");
    const stale = count("x_id_merge_pending_stale");
    const single = count("system_settings_single_row");
    results = [
      { id: "system_settings_single_row", label: "system_settings グローバル 1 行性", status: single === 1 ? "ok" : "warn", count: single, samples: [] },
      {
        id: "notification_processing_stuck",
        label: "notification_outbox processing 固着",
        status: stuck === 0 ? "ok" : "warn",
        count: stuck,
        samples: samples("notification_processing_stuck", (r) => r.a + " (" + (r.b ?? "?") + ")"),
        ...(stuck > 0 ? { note: "Worker が処理中のまま戻せていない通知です。再送制御または手動キャンセルを確認してください。" } : {}),
      },
      {
        id: "notification_failed_volume",
        label: "notification_outbox failed 件数",
        status: failed >= 20 ? "warn" : failed > 0 ? "info" : "ok",
        count: failed,
        samples: samples("notification_failed_volume", (r) => r.a + " (" + r.b + ")"),
        ...(failed > 0 ? { note: "失敗通知は手動再送またはキャンセルし、古い failed は cleanup の TTL で削除します。" } : {}),
      },
      {
        id: "open_moderation_cases_overdue",
        label: "未解決モデレーション期限切れ",
        status: overdue === 0 ? "ok" : "warn",
        count: overdue,
        samples: samples("open_moderation_cases_overdue", (r) => r.a + " video:" + r.b),
        ...(overdue > 0 ? { note: "期限切れの open case です。/admin/moderation で解決・却下・キャンセルしてください。" } : {}),
      },
      {
        id: "x_id_merge_pending_stale",
        label: "X ID 統合申請 pending 放置",
        status: stale === 0 ? "ok" : "warn",
        count: stale,
        samples: samples("x_id_merge_pending_stale", (r) => r.a + " @" + r.b + " -> @" + r.c),
        ...(stale > 0 ? { note: "危険操作のため自動実行せず、影響範囲を確認して承認・却下してください。" } : {}),
      },
    ];
  } catch {
    console.error("[adminRead] health checks failed");
    error = "query_failed";
    results = [];
  }
  const body: AdminHealthResponse = { status, results, error };
  return c.json(body);
});

// ---- /ops/integrity (health/integrity/page.tsx; src/lib/admin/integrityChecks.ts) ----
// CURRENT renders only the "run" prompt without ?run=1 (no query), and with ?run=1 runs 28 table-scanning checks
// (runIntegrityChecks, ~910 lines of check definitions) in one page load.
//
// STOP (recorded, not implemented): 28 scans cannot fit one S2 request (<= 3 D1 statements). The run=1 view is answered
// 501. Follow-up design (not built here): GET /ops/integrity/:checkId, one window-count statement per check
// (session + 1, LIMIT 10 sample), called one by one by the SPA; this needs the 28 makeCheck definitions ported from
// drizzle sql`` fragments to plain SQL with a per-check parity test.
adminOpsRoutes.get("/integrity", (c) => {
  if (c.req.query("run") === "1") return c.json({ error: "integrity_run_unsupported" }, 501);
  const body: AdminIntegrityResponse = { ran: false, results: [] };
  return c.json(body);
});

// ---- /ops/static-builds (static-builds/page.tsx) ----
// D1: session + queue rows (80) + one UNION ALL of the 4 aggregates (CURRENT 5 statements); KV: 1 get (backfill state,
// empty state on any failure as CURRENT); R2: 4 head() calls for the shared-input object state.
//
// STOP (recorded, not implemented): CURRENT also runs loadStaticSharedInputDiagnostics(), i.e. 4 R2 get + JSON.parse of
// artifacts up to 2-16 MiB through the Cache API to report loadStatus / generatedAt / itemCount. That exceeds the S2
// budget (JSON <= 64 KiB) and is exactly the R2 artifact reader MIG-0627 replaces with build-time snapshots, so only
// the object state (head) is returned and the SPA shows the rest as "not evaluated" until MIG-0627.
const MAX_STATIC_QUEUE_ROWS = 80;
const MAX_BACKFILL_FAILURE_ROWS = 20;
/** CURRENT src/lib/operationMode/policy.ts STATIC_REBUILD_ITEMS_PER_RUN (json-generator runs 1 target per run). */
const STATIC_REBUILD_ITEMS_PER_RUN = 1;
const SHARED_INPUT_OBJECTS = [
  { kind: "youtube_related_blocklist", objectKey: "youtube/related-blocklist.v1.json" },
  { kind: "random_video_pool", objectKey: "videos/random-pool.v1.json" },
  { kind: "pickup_creators", objectKey: "users/pickup-creators.v1.json" },
  { kind: "top_slot_stats", objectKey: "top/slot-stats.v1.json" },
] as const;

function backfillKindFromReason(reason: string): StaticBackfillKind | null {
  return (
    STATIC_BACKFILL_KINDS.find((kind) => reason === "backfill_" + kind || reason.startsWith("backfill_" + kind + "_")) ??
    null
  );
}

adminOpsRoutes.get("/static-builds", async (c) => {
  const [queue, aggregates, backfillState, sharedInputs] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, status, target_type, target_id, reason, priority, attempt_count, updated_at, error " +
        "FROM static_rebuild_queue ORDER BY updated_at DESC LIMIT ?",
    )
      .bind(MAX_STATIC_QUEUE_ROWS)
      .all<AdminStaticBuildsResponse["rows"][number]>(),
    c.env.DB.prepare(
      `SELECT 'bf_count' AS kind, reason AS a, status AS b, COUNT(*) AS n
         FROM static_rebuild_queue WHERE reason LIKE 'backfill_%' GROUP BY reason, status
       UNION ALL
       SELECT 'bf_fail' AS kind, reason AS a, error AS b, NULL AS n FROM (
         SELECT reason, error FROM static_rebuild_queue
          WHERE reason LIKE 'backfill_%' AND status IN ('failed', 'dead_letter')
          ORDER BY updated_at DESC LIMIT ?)
       UNION ALL
       SELECT 'count' AS kind, status AS a, NULL AS b, COUNT(*) AS n FROM static_rebuild_queue GROUP BY status
       UNION ALL
       SELECT 'mode' AS kind, operation_mode AS a, NULL AS b, NULL AS n FROM (SELECT operation_mode FROM system_settings LIMIT 1)`,
    )
      .bind(MAX_BACKFILL_FAILURE_ROWS)
      .all<{ kind: string; a: string | null; b: string | null; n: number | null }>(),
    (async () => {
      try {
        const raw = await c.env.KV?.get(STATIC_BACKFILL_KV_KEY);
        return raw ? parseStaticBackfillState(JSON.parse(raw)) : createEmptyStaticBackfillState();
      } catch {
        return createEmptyStaticBackfillState();
      }
    })(),
    Promise.all(
      SHARED_INPUT_OBJECTS.map(async ({ kind, objectKey }) => {
        try {
          const object = await c.env.BUCKET?.head(objectKey);
          if (c.env.BUCKET === undefined) return { kind, objectKey, objectState: "unavailable" as const };
          return { kind, objectKey, objectState: object ? ("present" as const) : ("missing" as const) };
        } catch {
          return { kind, objectKey, objectState: "unavailable" as const };
        }
      }),
    ),
  ]);

  const counts = { pending: 0, processing: 0, failed: 0, dead_letter: 0, done: 0 };
  let operationMode = resolveOperationMode(null);
  const backfillQueue = Object.fromEntries(
    STATIC_BACKFILL_KINDS.map((kind) => [kind, { pending: 0, processing: 0, failed: 0, lastError: null as string | null }]),
  ) as AdminStaticBuildsResponse["backfillQueue"];
  for (const row of aggregates.results) {
    if (row.kind === "count") {
      const n = Number(row.n ?? 0);
      if (row.a === "pending" || row.a === "processing" || row.a === "failed" || row.a === "dead_letter" || row.a === "done") {
        counts[row.a] = n;
      }
    } else if (row.kind === "mode") {
      operationMode = resolveOperationMode({ operation_mode: row.a });
    } else if (row.kind === "bf_count") {
      const kind = backfillKindFromReason(String(row.a ?? ""));
      if (!kind) continue;
      const count = Math.max(0, Number(row.n ?? 0));
      if (row.b === "pending") backfillQueue[kind].pending += count;
      if (row.b === "processing") backfillQueue[kind].processing += count;
      if (row.b === "failed" || row.b === "dead_letter") backfillQueue[kind].failed += count;
    }
  }
  for (const row of aggregates.results) {
    if (row.kind !== "bf_fail") continue;
    const kind = backfillKindFromReason(String(row.a ?? ""));
    if (!kind || backfillQueue[kind].lastError || !row.b) continue;
    backfillQueue[kind].lastError = row.b;
  }

  // ZERO_1102 S2: response <= 64 KiB (the queue rows carry error text).
  const rows: AdminStaticBuildsResponse["rows"] = [];
  let used = 0;
  let truncated = false;
  for (const row of queue.results) {
    const size = utf8Size(row);
    if (used + size > MAX_OPS_LIST_BYTES) {
      truncated = true;
      break;
    }
    used += size;
    rows.push(row);
  }
  const body: AdminStaticBuildsResponse = {
    operationMode,
    maxItemsPerRun: STATIC_REBUILD_ITEMS_PER_RUN,
    counts,
    backfillState,
    backfillQueue,
    sharedInputs,
    truncated,
    rows,
  };
  return c.json(body);
});

// ---- /ops/workers (workers/page.tsx; src/lib/admin/workerMonitoring.ts loadWorkerMonitoring) ----
// D1: session + 2 statements (CURRENT 7); KV: 4 gets of the last queue-wake failure (null on any KV failure, as CURRENT).
// No Cloudflare / external API is called: the page reads only internal D1 records.
adminOpsRoutes.get("/workers", async (c) => {
  let snapshot: AdminWorkersResponse["snapshot"] = null;
  let error: AdminWorkersResponse["error"] = null;
  try {
    snapshot = (await loadWorkerMonitoring(c.env.DB, { kv: c.env.KV })) as AdminWorkersResponse["snapshot"];
  } catch {
    console.error("[adminRead] worker monitoring failed");
    error = "query_failed";
  }
  const body: AdminWorkersResponse = { snapshot, error };
  return c.json(body);
});

// ---- /ops/security?run=1 (security/page.tsx; src/lib/admin/securityChecks.ts) ----
// CURRENT runs 7 count/sample queries in parallel and only when ?run=1. Here: two UNION ALL statements (3 + 4 checks)
// so the request stays at session + 2. A statement failure marks ITS checks as CURRENT's per-check failure result
// (warn, count 1, fixed note); CURRENT isolates every check on its own. The accounts.access_token check only COUNTs.
const SECURITY_LABELS = {
  access_token_not_null: "accounts.access_token が null でない行",
  rejected_xid_active: "rejected X ID が active_x_user_id に設定されている",
  unapproved_creator_videos: "未承認 X ID の creator_x_user_id を持つ作品",
  banned_user_videos: "BANされた投稿者が登録した作品",
  tos_not_accepted_user_videos: "TOS未同意の投稿者が登録した作品",
  custom_page_dangerous_html: "custom_pages/custom_themes disabled",
  banned_user_chapters: "BANユーザーにも紐づくX IDのチャプターコメント",
  orphan_approved_xid: "approved な X ID で認証ユーザー紐付けがない",
} as const;
type SecurityCheckId = keyof typeof SECURITY_LABELS;
type SecurityResult = AdminSecurityResponse["results"][number];

const SECURITY_CHECK_FAILED_NOTE =
  "検査自体の実行に失敗しました。DB接続、schema適用状況、サーバーログを確認してください。";

// SELECT check_id, total_count, a, b; one subquery per check, each LIMIT 10 like CURRENT (samples use the first 5).
const SECURITY_SELECTS: Record<Exclude<SecurityCheckId, "custom_page_dangerous_html">, string> = {
  access_token_not_null:
    "SELECT 'access_token_not_null' AS check_id, COUNT(*) AS total_count, NULL AS a, NULL AS b FROM account WHERE access_token IS NOT NULL",
  rejected_xid_active:
    "SELECT 'rejected_xid_active' AS check_id, total_count, id AS a, active_x_user_id AS b FROM (" +
    'SELECT "user".id AS id, "user".active_x_user_id AS active_x_user_id, COUNT(*) OVER() AS total_count FROM "user" ' +
    'INNER JOIN x_users ON x_users.id = "user".active_x_user_id ' +
    "WHERE \"user\".active_x_user_id IS NOT NULL AND x_users.approval_status = 'rejected' LIMIT 10)",
  unapproved_creator_videos:
    "SELECT 'unapproved_creator_videos' AS check_id, total_count, id AS a, creator_x_user_id AS b FROM (" +
    "SELECT videos.id AS id, videos.creator_x_user_id AS creator_x_user_id, COUNT(*) OVER() AS total_count FROM videos " +
    "INNER JOIN x_users ON x_users.id = videos.creator_x_user_id " +
    "WHERE videos.creator_x_user_id IS NOT NULL AND x_users.approval_status <> 'approved' LIMIT 10)",
  banned_user_videos:
    "SELECT 'banned_user_videos' AS check_id, total_count, id AS a, submitted_by_user_id AS b FROM (" +
    "SELECT videos.id AS id, videos.submitted_by_user_id AS submitted_by_user_id, COUNT(*) OVER() AS total_count FROM videos " +
    'INNER JOIN "user" ON "user".id = videos.submitted_by_user_id WHERE "user".is_banned = 1 LIMIT 10)',
  tos_not_accepted_user_videos:
    "SELECT 'tos_not_accepted_user_videos' AS check_id, total_count, id AS a, submitted_by_user_id AS b FROM (" +
    "SELECT videos.id AS id, videos.submitted_by_user_id AS submitted_by_user_id, COUNT(*) OVER() AS total_count FROM videos " +
    'INNER JOIN "user" ON "user".id = videos.submitted_by_user_id WHERE "user".is_tos_accepted <> 1 LIMIT 10)',
  banned_user_chapters:
    "SELECT 'banned_user_chapters' AS check_id, total_count, id AS a, x_user_id AS b FROM (" +
    "SELECT video_chapters.id AS id, video_chapters.x_user_id AS x_user_id, COUNT(*) OVER() AS total_count FROM video_chapters " +
    'WHERE EXISTS (SELECT 1 FROM x_user_account_links link INNER JOIN "user" auth_user ON auth_user.id = link.auth_user_id ' +
    "WHERE link.x_user_id = video_chapters.x_user_id AND auth_user.is_banned = 1) LIMIT 10)",
  orphan_approved_xid:
    "SELECT 'orphan_approved_xid' AS check_id, total_count, id AS a, NULL AS b FROM (" +
    "SELECT x_users.id AS id, COUNT(*) OVER() AS total_count FROM x_users WHERE x_users.approval_status = 'approved' " +
    "AND NOT EXISTS (SELECT 1 FROM x_user_account_links link WHERE link.x_user_id = x_users.id) LIMIT 10)",
};

function securityResult(id: SecurityCheckId, rows: Array<{ total_count: number | null; a: string | null; b: string | null }>): SecurityResult {
  const count = Number(rows[0]?.total_count ?? 0);
  const label = SECURITY_LABELS[id];
  const sample = (fn: (r: { a: string | null; b: string | null }) => string) => rows.slice(0, 5).map(fn);
  switch (id) {
    case "access_token_not_null":
      return {
        id: "access_token_not_null",
        label,
        status: count === 0 ? "ok" : "warn",
        count,
        samples: [],
        note: "OAuth トークンが残存しています。DBに平文トークンが保存されていないか確認してください。",
      };
    case "rejected_xid_active":
      return { id: "rejected_xid_active", label, status: count === 0 ? "ok" : "warn", count, samples: sample((r) => "user:" + r.a + " x:" + (r.b ?? "")) };
    case "unapproved_creator_videos":
      return { id: "unapproved_creator_videos", label, status: count === 0 ? "ok" : "warn", count, samples: sample((r) => "video:" + r.a + " creator:" + (r.b ?? "")) };
    case "banned_user_videos":
      return { id: "banned_user_videos", label, status: count === 0 ? "ok" : "warn", count, samples: sample((r) => "video:" + r.a + " submitter:" + r.b) };
    case "tos_not_accepted_user_videos":
      return { id: "tos_not_accepted_user_videos", label, status: count === 0 ? "ok" : "warn", count, samples: sample((r) => "video:" + r.a + " submitter:" + r.b) };
    case "banned_user_chapters":
      return {
        id: "banned_user_chapters",
        label,
        status: count === 0 ? "ok" : "warn",
        count,
        samples: sample((r) => "chapter:" + r.a + " x:" + r.b),
        ...(count > 0 ? { note: "紐づくX IDにBANユーザーが存在します。実際の投稿者を特定できる列はありません。" } : {}),
      };
    case "orphan_approved_xid":
      return {
        id: "orphan_approved_xid",
        label,
        status: count === 0 ? "ok" : "info",
        count,
        samples: sample((r) => "x:" + r.a),
        ...(count > 0 ? { note: "認証ユーザー紐付けがない approved X ID。公開名義として意図されたものか確認してください。" } : {}),
      };
    default:
      throw new Error("unreachable");
  }
}

adminOpsRoutes.get("/security", async (c) => {
  const statusQ = c.req.query("status");
  const status = statusQ === "warn" || statusQ === "info" || statusQ === "ok" ? statusQ : "all";
  const shouldRun = c.req.query("run") === "1";
  if (!shouldRun) {
    const idle: AdminSecurityResponse = { status, ran: false, results: [], error: null };
    return c.json(idle);
  }

  const groups: Array<Array<Exclude<SecurityCheckId, "custom_page_dangerous_html">>> = [
    ["access_token_not_null", "rejected_xid_active", "unapproved_creator_videos"],
    ["banned_user_videos", "tos_not_accepted_user_videos", "banned_user_chapters", "orphan_approved_xid"],
  ];
  const byId = new Map<string, SecurityResult>();
  for (const group of groups) {
    try {
      const { results } = await c.env.DB.prepare(group.map((id) => SECURITY_SELECTS[id]).join(" UNION ALL "))
        .all<{ check_id: string; total_count: number | null; a: string | null; b: string | null }>();
      for (const id of group) {
        byId.set(id, securityResult(id, results.filter((row) => row.check_id === id)));
      }
    } catch {
      console.error("[adminRead] security check group failed");
      for (const id of group) {
        byId.set(id, { id, label: SECURITY_LABELS[id], status: "warn", count: 1, samples: [], note: SECURITY_CHECK_FAILED_NOTE });
      }
    }
  }
  const staticOk: SecurityResult = {
    id: "custom_page_dangerous_html",
    label: SECURITY_LABELS.custom_page_dangerous_html,
    status: "ok",
    count: 0,
    samples: [],
    note: "初期本番では custom_pages/custom_themes は無効化されています。",
  };
  // CURRENT order: definitions order, then the two static info results.
  const order: SecurityCheckId[] = [
    "access_token_not_null",
    "rejected_xid_active",
    "unapproved_creator_videos",
    "banned_user_videos",
    "tos_not_accepted_user_videos",
    "custom_page_dangerous_html",
    "banned_user_chapters",
    "orphan_approved_xid",
  ];
  const results: SecurityResult[] = [
    ...order.map((id) => (id === "custom_page_dangerous_html" ? staticOk : (byId.get(id) as SecurityResult))),
    { id: "public_api_leak", label: "公開 API 内部情報漏洩", status: "info", count: 0, samples: [], note: "OK (whitelist enforced)" },
    {
      id: "notification_table_mismatch",
      label: "通知テーブル名の整合性 (Worker / ORM schema)",
      status: "info",
      count: 0,
      samples: [],
      note: "Cloudflare Workers / OpenNext runtime ではソースファイルを参照できないため、CI の静的検査で確認します。",
    },
  ];
  const body: AdminSecurityResponse = { status, ran: true, results, error: null };
  return c.json(body);
});

// ---- /ops/youtube-playlists (youtube-sync/playlists/page.tsx) ----
// D1: session + configured events (LIMIT 101) + per-event counts for the visible <= 100 events (one statement,
// ids passed as one json_each bind; CURRENT chunks the same ids by 80). Rows are ordered by derived health priority.
const MAX_PLAYLIST_SYNC_ROWS = 100;

adminOpsRoutes.get("/youtube-playlists", async (c) => {
  const first = (name: string) => (c.req.query(name) ?? "").trim();
  const enabledFilter = first("enabled");
  const statusFilter = first("status");
  const now = Math.floor(Date.now() / 1000);

  const conds: string[] = [];
  const params: unknown[] = [];
  if (enabledFilter === "1" || enabledFilter === "0") {
    conds.push("s.enabled = ?");
    params.push(Number(enabledFilter));
  }
  if (["disabled", "idle", "scanning", "synced", "deferred", "failed"].includes(statusFilter)) {
    conds.push("s.sync_status = ?");
    params.push(statusFilter);
  }
  const where = conds.length > 0 ? " WHERE " + conds.join(" AND ") : "";
  const config = await c.env.DB.prepare(
    "SELECT s.event_id AS event_id, e.title AS event_title, s.playlist_id AS playlist_id, s.enabled AS enabled, " +
      "s.sync_mode AS sync_mode, s.sync_interval_minutes AS sync_interval_minutes, s.sync_status AS sync_status, " +
      "s.next_sync_at AS next_sync_at, s.last_synced_at AS last_synced_at, s.last_full_scan_at AS last_full_scan_at, " +
      "s.last_error AS last_error FROM event_youtube_playlist_sync s INNER JOIN events e ON e.id = s.event_id" +
      where +
      " ORDER BY CASE s.sync_status WHEN 'failed' THEN 4 WHEN 'deferred' THEN 3 WHEN 'scanning' THEN 2 ELSE 1 END DESC, " +
      "s.next_sync_at ASC, e.title ASC LIMIT ?",
  )
    .bind(...params, MAX_PLAYLIST_SYNC_ROWS + 1)
    .all<Omit<AdminYoutubePlaylistsResponse["rows"][number], "linked_count" | "eligible_count" | "synced_count" | "health">>();
  const visible = config.results.slice(0, MAX_PLAYLIST_SYNC_ROWS);
  const hasMore = config.results.length > MAX_PLAYLIST_SYNC_ROWS;

  let rows: AdminYoutubePlaylistsResponse["rows"] = [];
  if (visible.length > 0) {
    const eventIds = Array.from(new Set(visible.map((row) => row.event_id).filter(Boolean)));
    const aggregate = await c.env.DB.prepare(
      `SELECT ve.event_id AS event_id,
         COUNT(DISTINCT CASE WHEN v.id IS NOT NULL AND v.visibility_status <> 'voided' THEN v.id END) AS linked_count,
         COUNT(DISTINCT CASE WHEN v.visibility_status = 'public' AND v.youtube_video_id IS NOT NULL
           AND v.youtube_video_id <> '' THEN v.id END) AS eligible_count,
         COUNT(DISTINCT CASE WHEN i.playlist_item_id IS NOT NULL AND v.visibility_status = 'public' THEN v.id END) AS synced_count
       FROM video_events ve
       LEFT JOIN videos v ON v.id = ve.video_id
       LEFT JOIN event_youtube_playlist_items i ON i.event_id = ve.event_id AND i.youtube_video_id = v.youtube_video_id
       WHERE ve.event_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
       GROUP BY ve.event_id`,
    )
      .bind(JSON.stringify(eventIds))
      .all<{ event_id: string; linked_count: number | null; eligible_count: number | null; synced_count: number | null }>();
    const counts = new Map(
      aggregate.results.map((row) => [
        row.event_id,
        {
          linked_count: Number(row.linked_count ?? 0),
          eligible_count: Number(row.eligible_count ?? 0),
          synced_count: Number(row.synced_count ?? 0),
        },
      ]),
    );
    rows = visible
      .map((row, originalIndex) => {
        const withCounts = {
          ...row,
          ...(counts.get(row.event_id) ?? { linked_count: 0, eligible_count: 0, synced_count: 0 }),
        };
        return {
          row: withCounts,
          originalIndex,
          health: derivePlaylistSyncHealth({
            enabled: withCounts.enabled,
            syncStatus: withCounts.sync_status,
            nextSyncAt: withCounts.next_sync_at,
            lastSyncedAt: withCounts.last_synced_at,
            lastFullScanAt: withCounts.last_full_scan_at,
            lastError: withCounts.last_error,
            eligibleCount: withCounts.eligible_count,
            syncedCount: withCounts.synced_count,
            linkedCount: withCounts.linked_count,
            now,
          }),
        };
      })
      .sort((a, b) => a.health.priority - b.health.priority || a.originalIndex - b.originalIndex)
      .map(({ row, health }) => ({ ...row, health }));
  }
  const body: AdminYoutubePlaylistsResponse = {
    filters: { enabled: enabledFilter, status: statusFilter },
    hasMore,
    rows,
  };
  return c.json(body);
});

// ---- /ops/youtube-quota (youtube-quota/page.tsx; src/lib/youtube/quotaPolicy.ts) ----
// D1: session + 1 row. No YouTube request is made (the page only reads the local usage counter).
const YOUTUBE_PROVIDER_KEY = "youtube";
const YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS = 10_000;
const YOUTUBE_TARGET_USAGE_PERCENT = 80;
const MIN_CONFIGURED_DAILY_QUOTA_UNITS = 100;
const MAX_CONFIGURED_DAILY_QUOTA_UNITS = 10_000_000;

function resolveYoutubeDailyQuotaUnits(raw: string | undefined): number {
  const parsed = Number.parseInt(raw?.trim() ?? "", 10);
  if (
    Number.isSafeInteger(parsed) &&
    parsed >= MIN_CONFIGURED_DAILY_QUOTA_UNITS &&
    parsed <= MAX_CONFIGURED_DAILY_QUOTA_UNITS
  ) {
    return parsed;
  }
  return YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS;
}

/** America/Los_Angeles date, the YouTube quota reset basis. */
function youtubeQuotaDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return values.get("year") + "-" + values.get("month") + "-" + values.get("day");
}

adminOpsRoutes.get("/youtube-quota", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const quotaDay = youtubeQuotaDay(new Date(now * 1_000));
  const raw = c.env.YOUTUBE_DAILY_QUOTA_LIMIT;
  const configuredFallback = resolveYoutubeDailyQuotaUnits(raw);
  const budgetFallback = Math.floor((configuredFallback * YOUTUBE_TARGET_USAGE_PERCENT) / 100);
  let row: { used_units: number | null; limit_units: number; updated_at: number } | null = null;
  let error: AdminYoutubeQuotaResponse["error"] = null;
  try {
    row = await c.env.DB.prepare(
      "SELECT used_units, limit_units, updated_at FROM external_api_quota_usage WHERE provider = ?1 AND quota_day = ?2 LIMIT 1",
    )
      .bind(YOUTUBE_PROVIDER_KEY, quotaDay)
      .first();
  } catch {
    console.error("[adminRead] youtube-quota read failed");
    error = "query_failed";
  }
  const rowBudget = Number(row?.limit_units ?? 0);
  const budgetUnits = rowBudget > 0 ? rowBudget : budgetFallback;
  const configuredUnits =
    rowBudget > 0 ? Math.ceil((rowBudget * 100) / YOUTUBE_TARGET_USAGE_PERCENT) : configuredFallback;
  const usedUnits = Math.max(0, Number(row?.used_units ?? 0));
  const body: AdminYoutubeQuotaResponse = {
    quotaDay,
    configuredUnits,
    budgetUnits,
    usedUnits,
    remainingUnits: Math.max(0, budgetUnits - usedUnits),
    usagePercent: budgetUnits > 0 ? Math.min(100, Math.round((usedUnits / budgetUnits) * 1_000) / 10) : 0,
    updatedAt: row?.updated_at ?? null,
    error,
  };
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
      const size = utf8Size(row);
      if (used + size > MAX_OPS_LIST_BYTES) {
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
    const size = utf8Size(row);
    if (used + size > MAX_OPS_LIST_BYTES) {
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

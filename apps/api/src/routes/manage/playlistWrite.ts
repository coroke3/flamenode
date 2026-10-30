/**
 * MIG-0655 U03 / SA-039: manually enqueue an event YouTube playlist sync.
 * D-15-6: commit the D1 intent and audit atomically; the sync-jobs Cron
 * collects it, and this API deliberately sends no Queue wake.
 * CURRENT: src/lib/actions/event-youtube-playlist.ts#queueEventYoutubePlaylistSync.
 * The parent manage router owns origin/session/write guard/DB and this route
 * enforces per-feature CostGuard plus event.publish.
 */
import { Hono } from "hono";
import { sql } from "@flamenode/server-core/sql";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded } from "../admin/body.ts";
import { resolveStaffPermissionKeys } from "./access.ts";

const NO_STORE = "private, no-store";
const GENERIC_FAILURE = "同期予約に失敗しました。再読み込みしてお試しください。";
const LEASE_MESSAGE = "再生リスト同期が実行中です。完了後にもう一度お試しください。";
const COLUMNS = [
  "event_id", "playlist_id", "enabled", "sync_mode", "sync_interval_minutes",
  "sync_status", "next_sync_at", "last_synced_at", "last_full_scan_at",
  "scan_started_at", "scan_page_token", "last_error", "last_attempt_at",
  "last_run_id", "last_duration_ms", "run_lease_token",
  "run_lease_expires_at", "pending_trigger", "created_at", "updated_at",
] as const;
type SyncRow = Record<(typeof COLUMNS)[number], string | number | null>;
type StaffRow = { permission_preset: string | null; custom_permission_keys_json: string | null };
const SAFE_EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const playlistWriteRoutes = new Hono<AppEnv>();
playlistWriteRoutes.use("*", costGuardMiddleware("manage_event_update"));
playlistWriteRoutes.post("/sync", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!SAFE_EVENT_ID.test(eventId)) return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  try {
    // One bounded read: the full before snapshot plus all approved/linked
    // event staff grants (101 sentinel detects truncation before authorization).
    const row = await c.env.DB.prepare(`
      SELECT
        (SELECT json_object(${COLUMNS.map((column) => `'${column}', s."${column}"`).join(", ")})
           FROM event_youtube_playlist_sync s WHERE s.event_id = ? LIMIT 1) AS sync_json,
        (SELECT json_group_array(json_object(
          'permission_preset', staff.permission_preset,
          'custom_permission_keys_json', staff.custom_permission_keys_json
        )) FROM (
          SELECT es.permission_preset, es.custom_permission_keys_json
          FROM event_staff es
          INNER JOIN x_user_account_links l ON l.x_user_id = es.x_user_id
          INNER JOIN x_users x ON x.id = l.x_user_id
          WHERE es.event_id = ? AND l.auth_user_id = ?
            AND x.approval_status = 'approved'
          LIMIT 101
        ) staff) AS staff_json
    `).bind(eventId, eventId, user.id).first<{ sync_json: string | null; staff_json: string | null }>();
    const grants = JSON.parse(row?.staff_json ?? "[]") as unknown;
    if (!Array.isArray(grants) || grants.length > 100) {
      return c.json({ ok: false, message: GENERIC_FAILURE }, 503);
    }
    const canPublish = user.role === "admin" || grants.some((grant): boolean => {
      if (!grant || typeof grant !== "object") return false;
      return resolveStaffPermissionKeys(grant as StaffRow).has("event.publish");
    });
    if (!canPublish) {
      return c.json({ ok: false, message: "YouTube再生リスト同期を実行予約する権限がありません。" }, 403);
    }
    const before = row?.sync_json ? JSON.parse(row.sync_json) as SyncRow : null;
    if (!before || before.enabled !== 1 || !before.playlist_id) {
      return c.json({ ok: false, message: "同期が有効になっていません。" }, 409);
    }
    const now = Math.floor(Date.now() / 1000);
    if (before.run_lease_token && Number(before.run_lease_expires_at ?? 0) > now) {
      return c.json({ ok: false, message: LEASE_MESSAGE }, 409);
    }
    const after: SyncRow = {
      ...before,
      sync_status: "idle", next_sync_at: now,
      last_full_scan_at: null, scan_started_at: null, scan_page_token: null,
      last_error: null, pending_trigger: "manual", run_lease_token: null,
      run_lease_expires_at: null, updated_at: now,
    };
    const db = c.get("db");
    // Keep CURRENT's lease predicate in the actual DML, not only preflight.
    // changes()=1 and strict audit are checked inside the same D1 batch.
    await mutateWithAudit(db, {
      mutationStatements: [db.run(sql`
        UPDATE event_youtube_playlist_sync
        SET sync_status = ${after.sync_status}, next_sync_at = ${after.next_sync_at},
            last_full_scan_at = NULL, scan_started_at = NULL, scan_page_token = NULL,
            last_error = NULL, pending_trigger = 'manual', run_lease_token = NULL,
            run_lease_expires_at = NULL, updated_at = ${after.updated_at}
        WHERE event_id = ${eventId}
          AND (run_lease_token IS NULL OR run_lease_expires_at IS NULL
               OR run_lease_expires_at <= ${now})
      `)],
      expectedMutationChanges: 1,
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "event_youtube_playlist_sync",
        target_id: eventId,
        operation: "UPDATE",
        before: { ...before },
        after: { ...after },
        actor_user_id: user.id,
        reason: "event-youtube-playlist-queue",
        context: `event:${eventId}`,
        retention_class: "normal",
        strict: true,
      }],
    });
    return c.json({ ok: true, queued: true }, 200);
  } catch {
    // No raw D1 error or SQL is exposed in response, logs, or audit.
    console.error("[MIG-0655] playlist sync request failed");
    return c.json({ ok: false, message: GENERIC_FAILURE }, 409);
  }
});
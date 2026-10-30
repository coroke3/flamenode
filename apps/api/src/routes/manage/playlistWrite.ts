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
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "../admin/body.ts";
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

/** CURRENT src/lib/youtube/playlist.ts mode, URL/ID and interval semantics. */
export function parsePlaylistSettings(value: Record<string, unknown>):
  | { ok: true; playlistId: string | null; mode: "off" | "append_only" | "mirror"; interval: number }
  | { ok: false; message: string } {
  const mode = value.sync_mode === "append_only" || value.sync_mode === "mirror"
    ? value.sync_mode : "off";
  const raw = String(value.playlist_id ?? "").trim();
  const valid = /^[A-Za-z0-9_-]{10,100}$/;
  let playlistId: string | null = valid.test(raw) ? raw : null;
  if (!playlistId && raw) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const id = url.searchParams.get("list")?.trim() ?? "";
      if ((url.protocol === "http:" || url.protocol === "https:") &&
        (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) &&
        valid.test(id)) playlistId = id;
    } catch { /* invalid URL => validation error */ }
  }
  if (raw && !playlistId) return { ok: false, message: "YouTube再生リストのURLまたはIDが正しくありません。" };
  if (mode !== "off" && !playlistId) return { ok: false, message: "同期を有効にするには再生リストURLまたはIDが必要です。" };
  const inputInterval = Number(String(value.sync_interval_minutes ?? "720"));
  const interval = Number.isInteger(inputInterval)
    ? Math.min(10080, Math.max(60, inputInterval)) : 720;
  return { ok: true, playlistId, mode, interval };
}

/** SA-038: SETTINGS UPSERT, optional item reset and projection enqueue
 * committed in the same strict audited batch. No wake (D-15-6). */
playlistWriteRoutes.put("/", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!SAFE_EVENT_ID.test(eventId)) return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  const request = await readAdminJsonBody(c.req.raw);
  if (request.kind === "too_large") return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  if (request.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const parsed = parsePlaylistSettings(request.value);
  if (!parsed.ok) return c.json({ ok: false, message: parsed.message }, 400);
  try {
    // Fold permission, event existence, all snapshot fields, reset count into
    // ONE pre-read. No partial approval if 101+ staff records are present.
    const row = await c.env.DB.prepare(`
      SELECT
        (SELECT id FROM events WHERE id=? LIMIT 1) AS exists_id,
        (SELECT json_object(${COLUMNS.map((key) => `'${key}', s."${key}"`).join(", ")})
         FROM event_youtube_playlist_sync s WHERE s.event_id=? LIMIT 1) AS sync_json,
        (SELECT COUNT(*) FROM event_youtube_playlist_items WHERE event_id=?) AS item_count,
        (SELECT json_group_array(json_object('permission_preset', q.permission_preset,
          'custom_permission_keys_json', q.custom_permission_keys_json)) FROM (
           SELECT es.permission_preset, es.custom_permission_keys_json
           FROM event_staff es
           JOIN x_user_account_links l ON l.x_user_id=es.x_user_id
           JOIN x_users x ON x.id=l.x_user_id
           WHERE es.event_id=? AND l.auth_user_id=? AND x.approval_status='approved'
           LIMIT 101
        ) q) AS staff_json
    `).bind(eventId,eventId,eventId,eventId,user.id)
      .first<{exists_id: string | null; sync_json: string | null; item_count: number; staff_json: string | null}>();
    if (!row?.exists_id) return c.json({ ok: false, message: "イベントが見つかりません。" }, 404);
    const grants: unknown = JSON.parse(row.staff_json ?? "[]");
    if (!Array.isArray(grants) || grants.length > 100) {
      return c.json({ ok: false, message: GENERIC_FAILURE }, 503);
    }
    if (user.role !== "admin" && !grants.some((grant) =>
      grant && typeof grant === "object" &&
      resolveStaffPermissionKeys(grant as StaffRow).has("event.publish"))) {
      return c.json({ ok: false, message: "YouTube再生リスト同期を変更する権限がありません。" }, 403);
    }
    const before = row.sync_json ? JSON.parse(row.sync_json) as SyncRow : null;
    const now = Math.floor(Date.now()/1000);
    if (before?.run_lease_token && Number(before.run_lease_expires_at ?? 0) > now) {
      return c.json({ ok: false, message: LEASE_MESSAGE }, 409);
    }
    const enabled = parsed.mode === "off" ? 0 : 1;
    const changed = (before?.playlist_id ?? null) !== parsed.playlistId;
    const after = {
      event_id: eventId, playlist_id: parsed.playlistId, enabled,
      sync_mode: parsed.mode, sync_interval_minutes: parsed.interval,
      sync_status: enabled ? "idle" : "disabled",
      next_sync_at: enabled ? now : null,
      last_synced_at: changed ? null : (before?.last_synced_at ?? null),
      last_full_scan_at: null, scan_started_at: null,
      scan_page_token: null, last_error: null,
      pending_trigger: enabled ? "settings_change" : null,
      run_lease_token: null, run_lease_expires_at: null,
      created_at: before?.created_at ?? now, updated_at: now,
    };
    const db = c.get("db");
    const queue = await buildStaticRebuildQueueBatch(db, [{
      targetType: "event_base", targetId: eventId,
      reason: "event_youtube_playlist_settings", priority: "high",
      requestedByUserId: user.id,
    }]);
    const mutation = db.run(sql`
      INSERT INTO event_youtube_playlist_sync (
        event_id,playlist_id,enabled,sync_mode,sync_interval_minutes,
        sync_status,next_sync_at,last_synced_at,last_full_scan_at,scan_started_at,
        scan_page_token,last_error,pending_trigger,run_lease_token,
        run_lease_expires_at,created_at,updated_at
      ) VALUES (
        ${after.event_id},${after.playlist_id},${after.enabled},
        ${after.sync_mode},${after.sync_interval_minutes},
        ${after.sync_status},${after.next_sync_at},${after.last_synced_at},
        NULL,NULL,NULL,NULL,${after.pending_trigger},NULL,NULL,
        ${after.created_at},${after.updated_at}
      )
      ON CONFLICT(event_id) DO UPDATE SET
        playlist_id=excluded.playlist_id, enabled=excluded.enabled,
        sync_mode=excluded.sync_mode, sync_interval_minutes=excluded.sync_interval_minutes,
        sync_status=excluded.sync_status, next_sync_at=excluded.next_sync_at,
        last_synced_at=excluded.last_synced_at,
        last_full_scan_at=NULL, scan_started_at=NULL, scan_page_token=NULL,
        last_error=NULL, pending_trigger=excluded.pending_trigger,
        run_lease_token=NULL, run_lease_expires_at=NULL,
        updated_at=excluded.updated_at
      WHERE run_lease_token IS NULL OR run_lease_expires_at IS NULL
        OR run_lease_expires_at <= ${now}
    `);
    const mutations = [mutation];
    const expected = [1];
    if (changed && row.item_count > 0) {
      mutations.push(db.run(sql`DELETE FROM event_youtube_playlist_items WHERE event_id=${eventId}`));
      expected.push(row.item_count);
    }
    await mutateWithAudit(db, {
      mutationStatements: [...mutations, ...queue.statements],
      expectedMutationChanges: [...expected, ...queue.expectedChanges],
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "event_youtube_playlist_sync", target_id: eventId,
        operation: before ? "UPDATE" : "CREATE",
        before: before ?? null, after, actor_user_id: user.id,
        reason: "event-youtube-playlist-settings",
        context: `event:${eventId}`, retention_class: "normal", strict: true,
      }],
    });
    return c.json({ ok: true, saved: true }, 200);
  } catch {
    console.error("[MIG-0655] playlist settings save failed");
    return c.json({ ok: false,
      message: "設定を保存できませんでした。同じ再生リストが別イベントに設定されていないか確認してください。" }, 409);
  }
});

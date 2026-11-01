#!/usr/bin/env node
/**
 * MIG-0609 U01. LOCAL ONLY. No deployment, account API, remote D1 or R2.
 * Workerd V8 profiler samples (not wall time) are used for CPU.
 * The wrapper blocks ALL outbound fetches before importing a worker entry.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { aggregate, judge, MIN_SAMPLES, summarize } from "./benchmark-api-cpu.mjs";
import { materializeD1CompatibleMigrations } from "./d1-migration-compat.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BUDGET_MS = 8;
export const FIXED_TIME = 1760000000000;
export const WORKERS = Object.freeze([
  { id: "content", entry: "workers/content-jobs/index.ts", cron: "15 * * * *", queue: "flamenode-static-rebuild-wake", wakeKind: "static_rebuild_available" },
  { id: "fast", entry: "workers/fast-jobs/index.ts", cron: "0 * * * *", queue: "flamenode-notification-wake", wakeKind: "notification_available" },
  { id: "sync", entry: "workers/sync-jobs/index.ts", cron: "7,52 * * * *", queue: "flamenode-youtube-sync-wake", wakeKind: "youtube_sync_pending" },
]);
export const plan = () => WORKERS.flatMap(w => [
  { id: w.id + ".scheduled", worker: w.id, kind: "scheduled", cron: w.cron, inputMax: 1 },
  { id: w.id + ".queue", worker: w.id, kind: "queue", queue: w.queue, wakeKind: w.wakeKind, inputMax: 10 },
]);

// ---------------------------------------------------------------------------------------------
// U02 named per-job fixtures. Each job runs the CURRENT job function directly inside the wrapper
// (no job code is edited) against a freshly seeded LOCAL D1/R2/KV before EVERY sample.
// `run` is inlined into the wrapper; `seed(kind)` -> seed spec; `check(kind, result)` proves the
// job really processed the seeded input (an empty/skipped run is NOT a valid measurement).
// ---------------------------------------------------------------------------------------------
export const seedNow = () => Math.floor(Date.now() / 1000);
/** Tables any fixture may touch. Cleared (FK-deferred) before every seed so jobs never see each other's rows. */
export const RESET_TABLES = Object.freeze([
  "notification_outbox", "spreadsheet_import_runs", "event_youtube_playlist_sync_runs",
  "event_youtube_playlist_items", "event_youtube_playlist_sync", "audit_logs", "slots",
  "video_youtube_metadata", "static_rebuild_queue", "static_artifacts", "videos", "events", "x_identity_requests",
  "x_user_account_links", "x_user_aliases", "x_users", "worker_leases", "external_api_quota_usage",
  "system_settings", "public_build_state", "user",
]);
/** Multi-row INSERT without a payload: rows i = 1..n come from a recursive CTE; extra binds follow n. */
export function gen(n, table, columns, exprs, ...binds) {
  return ["WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) INSERT INTO " +
    table + " (" + columns.join(", ") + ") SELECT " + exprs.join(", ") + " FROM n", n, ...binds];
}
const benchUser = ["INSERT INTO \"user\" (id, name, discord_id, is_notification_enabled) VALUES ('bench-user', 'Bench user', '900000000000000001', 1)"];
const seedBase = (spec = {}) => ({ clearTables: [...RESET_TABLES], ...spec, sql: [benchUser, ...(spec.sql ?? [])] });
const NONCE = "printf('%08x-0000-0000-0000-%012x', i, i)";
const HEX64 = "printf('%064x', i)";
const ONE = kind => (kind === "normal" ? 1 : 0);

// Heaviest of the 7 whole-catalogue targets probed on 300 public videos (search_index 674 ms vs 100-208 ms for the rest).
const REBUILD_NORMAL_TARGET = ["list_recent", "global"], REBUILD_LIMIT_TARGET = ["search_index", "global"];
export const JOBS = Object.freeze([
  {
    id: "cache-cleanup", worker: "content", label: "OpenNext incremental cache cleanup", limit: 200,
    modules: ["workers/cleanup/incrementalCache.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/cleanup/incrementalCache.ts'); return await m.cleanupIncrementalCache({ R2: env.R2, KV: env.KV }, undefined, Date.now() + 31 * 86400000); }",
    seed: kind => seedBase({
      clearR2: "incremental-cache/", kv: { "cleanup:incremental-cache:v1": null },
      r2Count: kind === "limit" ? 201 : kind === "invalid" ? 10 : 1,
      r2Prefix: "incremental-cache/bench/", r2Hex: kind !== "invalid", r2Suffix: kind === "invalid" ? ".txt" : ".cache",
    }),
    check: (kind, r) => Boolean(r) && r.skipped === false && (kind === "invalid" ? r.deleted === 0 && r.scanned === 10
      : kind === "limit" ? r.deleted === 200 && r.scanned === 200 && r.hasMore === true : r.deleted === 1 && r.scanned === 1),
  },
  {
    id: "audit-cleanup", worker: "content", label: "Retention / audit cleanup", limit: 500,
    modules: ["workers/cleanup/index.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/cleanup/index.ts'); return await m.runCleanupWithRetry(env); }",
    seed: kind => {
      const n = kind === "limit" ? 600 : 1;
      const now = seedNow();
      const old = now - 400 * 86400;
      // invalid = rows that match NO retention predicate (too new / wrong status) and a corrupt retention setting.
      const bad = kind === "invalid";
      const sql = [["INSERT INTO events (id, title) VALUES ('bench-event', 'Bench event')"],
        ["INSERT INTO system_settings (id, audit_compact_after_days) VALUES ('default', ?)", bad ? -5 : 30]];
      const outboxAt = bad ? now : old;
      sql.push(gen(n, "notification_outbox", ["id", "recipient_user_id", "type", "payload_json", "status", "created_at"],
        ["'sent-' || i", "'bench-user'", "'dm'", "'{}'", "'sent'", "?"], outboxAt));
      sql.push(gen(n, "notification_outbox", ["id", "recipient_user_id", "type", "payload_json", "status", "created_at"],
        ["'failed-' || i", "'bench-user'", "'dm'", "'{}'", "'failed'", "?"], outboxAt));
      sql.push(gen(n, "spreadsheet_import_runs", ["nonce", "operator_user_id", "table_name", "mode", "payload_hash", "schema_fingerprint", "expires_at", "consumed_at", "created_at"],
        [NONCE, "'bench-user'", "'videos'", "'insert'", HEX64, HEX64, "?", bad ? "NULL" : "?", "?"], ...(bad ? [now + 86400, now - 10] : [old + 10, old + 5, old])));
      sql.push(gen(n, "event_youtube_playlist_sync_runs", ["run_id", "event_id", "playlist_id", "trigger", "dispatch_source", "status", "started_at", "created_at"],
        ["'stale-' || i", "'bench-event'", "'PLbench'", "'scheduled'", "'cron'", bad ? "'succeeded'" : "'running'", "?", "?"], bad ? now : old, bad ? now : old));
      sql.push(gen(n, "event_youtube_playlist_sync_runs", ["run_id", "event_id", "playlist_id", "trigger", "dispatch_source", "status", "started_at", "finished_at", "created_at"],
        ["'done-' || i", "'bench-event'", "'PLbench'", "'scheduled'", "'cron'", "'succeeded'", "?", bad ? "NULL" : "?", "?"], ...(bad ? [now, now] : [old, old, old])));
      sql.push(gen(n, "audit_logs", ["id", "table_name", "target_id", "operation", "actor_user_id", "restore_status", "expires_at", "created_at"],
        ["'restorable-' || i", "'videos'", "'v'", "'UPDATE'", "'bench-user'", bad ? "'not_restorable'" : "'restorable'", bad ? "NULL" : "?", "?"], ...(bad ? [now] : [old, now])));
      sql.push(gen(n, "audit_logs", ["id", "table_name", "target_id", "operation", "actor_user_id", "expires_at", "created_at"],
        ["'expired-' || i", "'videos'", "'v'", "'UPDATE'", "'bench-user'", bad ? "NULL" : "?", "?"], ...(bad ? [now] : [old, now])));
      sql.push(gen(n, "audit_logs", ["id", "table_name", "target_id", "operation", "before_json", "actor_user_id", "created_at"],
        ["'compact-' || i", "'videos'", "'v'", "'UPDATE'", bad ? "NULL" : "'{\"title\":\"before\"}'", "'bench-user'", "?"], bad ? now : old));
      return seedBase({ sql });
    },
    // normal/limit: every retention statement must change rows (limit: each statement capped at 500).
    check: (kind, r) => Boolean(r) && r.processed === 1 && r.failed === 0 && r.retry_count === 0 &&
      (kind === "invalid" ? r.d1_changes === 0 : kind === "limit" ? r.d1_changes === 4000 : r.d1_changes === 10),
  },
  {
    id: "slot-reminders", worker: "fast", label: "Slot deadline reminders", limit: 50,
    modules: ["workers/notification-dispatcher/reminders.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/notification-dispatcher/reminders.ts'); return { enqueued: await m.enqueueSlotDeadlineReminders({ ...env, NEXT_PUBLIC_SITE_URL: 'https://bench.example.com' }) }; }",
    seed: kind => {
      const n = kind === "limit" ? 60 : 1;
      const now = seedNow();
      const qualifies = kind !== "invalid"; // invalid: deadline already passed + notifications disabled
      return seedBase({ sql: [
        gen(n, "\"user\"", ["id", "name", "is_notification_enabled"], ["'rem-user-' || i", "'Reminder user ' || i", qualifies ? "1" : "0"]),
        gen(n, "events", ["id", "title", "visibility_status", "entry_start_time", "entry_end_time"],
          ["'rem-event-' || i", "'Reminder event ' || i", "'public'", "?", "?"], now - 86400, qualifies ? now + 3600 * 12 + 0 : now - 60),
        gen(n * 2, "slots", ["id", "event_id", "reserved_by_user_id", "status", "start_time"],
          ["'rem-slot-' || i", "'rem-event-' || ((i + 1) / 2)", "'rem-user-' || ((i + 1) / 2)", "'reserved'", "?"], now + 86400 * 3),
      ] });
    },
    check: (kind, r) => Boolean(r) && (kind === "invalid" ? r.enqueued === 0 : kind === "limit" ? r.enqueued === 50 : r.enqueued === 1),
  },
  {
    id: "score-recalc", worker: "sync", label: "Score recalculation", limit: 150,
    modules: ["workers/score-recalc/index.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/score-recalc/index.ts'); return await m.recalcScoreBatch(env); }",
    seed: kind => {
      const n = kind === "limit" ? 200 : 1;
      const now = seedNow();
      const visible = kind !== "invalid"; // invalid: not public -> not eligible
      return seedBase({ sql: [
        gen(n, "videos", ["id", "submitted_by_user_id", "creator_display_name", "title", "visibility_status", "scheduled_time", "app_like_count", "updated_at"],
          ["'score-video-' || i", "'bench-user'", "'Creator'", "'Video ' || i", visible ? "'public'" : "'pending'", "? - i * 3600", "i % 7", "?"], now - 86400, now - 100),
        gen(n, "video_youtube_metadata", ["video_id", "view_count", "sync_status", "updated_at"], ["'score-video-' || i", "i * 11", "'synced'", "?"], now - 90),
      ] });
    },
    check: (kind, r) => Boolean(r) && r.failed === 0 && (kind === "invalid" ? r.processed === 0 && r.skipped === 1
      : kind === "limit" ? r.processed === 150 : r.processed === 1),
  },
  {
    id: "notification-dispatch", worker: "fast", label: "Notification lease recovery + Discord DM dispatch", limit: 6,
    modules: ["workers/notification-dispatcher/dispatch.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/notification-dispatcher/dispatch.ts'); return await m.processNotificationQueue({ ...env, DISCORD_BOT_TOKEN: 'bench-bot-token' }); }",
    seed: kind => {
      // Unique discord ids per seed: the dispatcher caches DM channels in memory, so reusing ids
      // would silently skip the "open DM channel" request and under-measure the worst case.
      const tag = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
      const now = seedNow();
      const rows = kind === "limit" ? 8 : 1;
      const leases = kind === "limit" ? 6 : 0;
      const bad = kind === "invalid"; // payload is not a Discord message body -> permanent failure, 0 external requests
      const total = rows + leases;
      return seedBase({ sql: [
        gen(total, "\"user\"", ["id", "name", "discord_id", "is_notification_enabled"], ["'nd-user-' || i", "'Notify ' || i", "? || printf('%09d', i)", "1"], "7" + tag),
        gen(rows, "notification_outbox", ["id", "recipient_user_id", "type", "payload_json", "delivery_route", "status", "created_at"],
          ["'nd-pending-' || i", "'nd-user-' || i", "'dm'", bad ? "'not json'" : "'{\"content\":\"FlameNode bench notification\"}'", "'dm'", "'pending'", "? + i"], now - 600),
        ...(leases > 0 ? [gen(leases, "notification_outbox", ["id", "recipient_user_id", "type", "payload_json", "delivery_route", "status", "attempt_count", "lease_token", "lease_expires_at", "processing_started_at", "created_at"],
          ["'nd-lease-' || i", "'nd-user-' || (CAST(? AS INTEGER) + i)", "'dm'", "'{\"content\":\"lease bench\"}'", "'dm'", "'processing'", "1", "'old-lease'", "?", "?", "?"], rows, now - 3600, now - 4000, now - 5000)] : []),
      ] });
    },
    check: (kind, r) => Boolean(r) && (kind === "invalid" ? r.failed === 1 && r.processed === 0 && r.external_api_calls === 0
      : kind === "limit" ? r.processed === 6 && r.failed === 0 && r.external_api_calls === 12
        : r.processed === 1 && r.failed === 0 && r.external_api_calls === 2),
  },
  {
    id: "youtube-sync", worker: "sync", label: "YouTube metadata sync (scheduled)", limit: 200,
    modules: ["workers/youtube-sync/index.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/youtube-sync/index.ts'); const r = await m.syncBatch({ ...env, YOUTUBE_API_KEY: 'bench-api-key' }, undefined, undefined, { mode: 'scheduled_only', includePending: true }); return { processed: r.processed, failed: r.failed, skipped: r.skipped, external_api_calls: r.external_api_calls, d1_changes: r.d1_changes, quota_stopped: r.quota_stopped, changed: r.changed_video_ids.length }; }",
    seed: kind => {
      const n = kind === "limit" ? 200 : 1;
      const now = seedNow();
      const ytId = kind === "invalid" ? "'missing-' || printf('%011d', i)" : "printf('yt%09d', i)"; // invalid: API returns no item
      return seedBase({ kv: { "external-api:youtube:quota-cooldown-until": null }, sql: [
        gen(n, "videos", ["id", "submitted_by_user_id", "creator_display_name", "title", "visibility_status", "youtube_video_id", "scheduled_time", "updated_at"],
          ["'yt-video-' || i", "'bench-user'", "'Creator'", "'Video ' || i", "'public'", ytId, "? - i", "?"], now - 86400, now - 100),
        // first half pending, second half synced 2 days ago (default scheduled lane) when n is large.
        gen(n, "video_youtube_metadata", ["video_id", "sync_status", "synced_at", "view_count", "updated_at"],
          ["'yt-video-' || i", "CASE WHEN i * 2 <= " + n + " OR " + n + " = 1 THEN 'pending' ELSE 'synced' END", "CASE WHEN i * 2 <= " + n + " OR " + n + " = 1 THEN NULL ELSE ? END", "5", "?"], now - 2 * 86400, now - 2 * 86400),
      ] });
    },
    check: (kind, r) => Boolean(r) && r.failed === 0 && r.quota_stopped === false && (kind === "limit"
      ? r.processed === 200 && r.external_api_calls === 4 : r.processed === 1 && r.external_api_calls === 1),
  },
  {
    id: "youtube-blocked-recheck", worker: "sync", label: "Blocked (private/missing) YouTube recheck", limit: 10,
    modules: ["workers/youtube-sync/index.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/youtube-sync/index.ts'); const r = await m.syncBatch({ ...env, YOUTUBE_API_KEY: 'bench-api-key' }, undefined, undefined, { mode: 'blocked_recheck_only' }); return { processed: r.processed, failed: r.failed, skipped: r.skipped, external_api_calls: r.external_api_calls, d1_changes: r.d1_changes, quota_stopped: r.quota_stopped }; }",
    seed: kind => {
      const n = kind === "limit" ? 14 : 1;
      const now = seedNow();
      // invalid = blocked rows that were rechecked within the last week -> not due -> nothing to fetch.
      const checkedAt = kind === "invalid" ? now - 3600 : now - 8 * 86400;
      return seedBase({ kv: { "external-api:youtube:quota-cooldown-until": null }, sql: [
        gen(n, "videos", ["id", "submitted_by_user_id", "creator_display_name", "title", "visibility_status", "youtube_video_id", "updated_at"],
          ["'yb-video-' || i", "'bench-user'", "'Creator'", "'Blocked ' || i", "'public'", "printf('yb%09d', i)", "?"], now - 9 * 86400),
        gen(n, "video_youtube_metadata", ["video_id", "youtube_privacy_status", "youtube_availability_status", "sync_status", "synced_at", "updated_at"],
          ["'yb-video-' || i", "'private'", "'private'", "'failed'", "?", "?"], checkedAt, checkedAt),
      ] });
    },
    check: (kind, r) => Boolean(r) && r.failed === 0 && (kind === "invalid" ? r.processed === 0 && r.skipped === 1 && r.external_api_calls === 0
      : kind === "limit" ? r.processed === 10 && r.external_api_calls === 1 : r.processed === 1 && r.external_api_calls === 1),
  },
  {
    id: "ga4-ranking", worker: "sync", label: "GA4 trending ranking sync", limit: 200,
    modules: ["workers/ga-analytics/sync.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/ga-analytics/sync.ts'); const r = await m.syncGa4Trending({ ...env, GA4_SYNC_ENABLED: '1', GA4_PROPERTY_ID: '123456789', GA4_SERVICE_ACCOUNT_EMAIL: 'bench@bench.iam.gserviceaccount.com', GA4_SERVICE_ACCOUNT_PRIVATE_KEY: globalThis.__ga4?.pem ?? '' }); return { processed: r.processed, failed: r.failed, skipped: r.skipped, external_api_calls: r.external_api_calls }; }",
    seed: kind => {
      // limit: 1000 public videos, every one with 4 GA4 date-range rows -> ranking truncates to the 200-item cap.
      const n = kind === "limit" ? 1000 : 1;
      const now = seedNow();
      return seedBase({ kv: { "ga4:access-token:v1": null }, clearR2: "analytics/", ga4: { videos: n, unknown: kind === "invalid" },
        sql: [gen(n, "videos", ["id", "submitted_by_user_id", "creator_display_name", "title", "visibility_status", "scheduled_time", "updated_at"],
          ["'ga-video-' || i", "'bench-user'", "'Creator'", "'GA video ' || i", "'public'", "? - i", "?"], now - 86400, now - 100)] });
    },
    check: (kind, r) => Boolean(r) && r.failed === 0 && r.skipped === 0 && (kind === "limit" ? r.processed === 200
      : kind === "invalid" ? r.processed === 0 : r.processed === 1),
  },
  {
    id: "daily-top-enqueue", worker: "content", label: "Daily nostalgic top shuffle enqueue (G18)", limit: 1,
    modules: ["workers/json-generator/rebuild.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/json-generator/rebuild.ts'); const added = await m.ensureDailyTopNostalgicShuffle(env); const row = await env.DB.prepare(\"SELECT COUNT(*) AS n FROM static_rebuild_queue WHERE target_type = 'top_nostalgic'\").first(); return { added, queued: row?.n ?? 0 }; }",
    seed: kind => seedBase({ kv: { "static:top_nostalgic_shuffle_day": kind === "invalid" ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date()) : null }, sql: [] }),
    // invalid = today's shuffle was already recorded -> job must be a no-op.
    check: (kind, r) => Boolean(r) && (kind === "invalid" ? r.added === 0 && r.queued === 0 : r.added === 1 && r.queued === 1),
  },
  {
    id: "x-slot-bind-recovery", worker: "content", label: "X ID slot bind recovery", limit: 5,
    modules: ["workers/content-jobs/xIdSlotBindRecovery.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/content-jobs/xIdSlotBindRecovery.ts'); return await m.reconcilePendingXIdSlotBinds({ DB: env.DB }, undefined, { d1_changes: 0 }); }",
    seed: kind => {
      // limit = the CURRENT caps: 5 requests x 30 slots (X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT / _SLOT_LIMIT).
      // invalid = approved request whose X ID has no approved x_users row -> no bind target -> completes with 0 bound.
      const requests = kind === "limit" ? 5 : 1, perRequest = kind === "limit" ? 30 : 1;
      const now = seedNow();
      const approved = kind !== "invalid";
      return seedBase({ sql: [
        ["INSERT INTO events (id, title, visibility_status) VALUES ('sb-event-1', 'Bind 1', 'public'), ('sb-event-2', 'Bind 2', 'public'), ('sb-event-3', 'Bind 3', 'public')"],
        gen(requests, "\"user\"", ["id", "name"], ["'xb-user-' || i", "'Bind user ' || i"]),
        gen(requests, "x_users", ["id", "x_name", "approval_status"], ["'xid' || i", "'X name ' || i", approved ? "'approved'" : "'pending'"]),
        gen(requests, "x_identity_requests", ["id", "request_type", "requested_by_auth_user_id", "requested_x_id", "status", "slot_bind_status", "slot_bind_attempt_count", "requested_at", "updated_at"],
          ["'xr-' || i", "'new_link'", "'xb-user-' || i", "'xid' || i", "'approved'", "'pending'", "0", "?", "?"], now - 600, now - 300),
        gen(requests, "x_user_account_links", ["x_user_id", "auth_user_id"], ["'xid' || i", "'xb-user-' || i"]),
        gen(requests * perRequest, "slots", ["id", "event_id", "reserved_by_user_id", "reserved_x_id_snapshot", "status", "start_time", "sort_order"],
          ["'sb-slot-' || i", "'sb-event-' || (((i - 1) % " + perRequest + ") / 10 + 1)", "'xb-user-' || ((i - 1) / " + perRequest + " + 1)", "'xid' || ((i - 1) / " + perRequest + " + 1)", "'reserved'", "? + i * 60", "i"], now + 86400),
      ] });
    },
    check: (kind, r) => Boolean(r) && r.failed === 0 && (kind === "limit" ? r.processed === 5 && r.completed === 5 && r.bound === 150
      : kind === "invalid" ? r.processed === 1 && r.completed === 1 && r.bound === 0 : r.processed === 1 && r.completed === 1 && r.bound === 1),
  },
  {
    id: "static-rebuild-queue", worker: "content", label: "Static rebuild queue processing (retired by MIG-0907)", limit: 1,
    modules: ["workers/json-generator/queue.ts", "workers/shared/rebuildEnvironment.ts"],
    run: "async (env, ctx, kind, imp) => { const q = await imp('workers/json-generator/queue.ts'); const re = await imp('workers/shared/rebuildEnvironment.ts'); const r = await q.processStaticRebuildQueue(re.rebuildEnvironment(env)); return { processed: r.processed, failed: r.failed, skipped: r.skipped, d1_changes: r.d1_changes, hasMore: r.hasMore }; }",
    seed: kind => {
      // CURRENT cap = MAX_QUEUE_ITEMS_PER_RUN = 1 row per run. normal = one small 'list_recent' row (3 videos);
      // limit = the heaviest probed single target ('search_index') over 300 public videos; invalid = unknown target_type.
      const videos = kind === "limit" ? 300 : 3;
      const now = seedNow();
      const target = kind === "limit" ? REBUILD_LIMIT_TARGET : kind === "invalid" ? ["no_such_target", "x"] : REBUILD_NORMAL_TARGET;
      return seedBase({ clearR2: "", r2Json: { "youtube/related-blocklist.v1.json": JSON.stringify({ schema_version: 1, generated_at: now, blocked: {} }) }, sql: [
        gen(videos, "videos", ["id", "submitted_by_user_id", "creator_display_name", "title", "visibility_status", "youtube_video_id", "scheduled_time", "updated_at"],
          ["'reb-video-' || i", "'bench-user'", "'Creator'", "'Rebuild video ' || i", "'public'", "printf('rb%09d', i)", "? - i * 60", "?"], now - 86400, now - 100),
        gen(videos, "video_youtube_metadata", ["video_id", "sync_status", "synced_at", "view_count", "duration_seconds", "youtube_privacy_status", "updated_at"],
          ["'reb-video-' || i", "'synced'", "?", "i * 3", "200", "'public'", "?"], now - 90, now - 90),
        ["INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, priority, status, created_at, updated_at) VALUES ('reb-q-1', ?, ?, 'bench', 'high', 'pending', ?, ?)", target[0], target[1], now - 10, now - 10],
      ] });
    },
    check: (kind, r) => Boolean(r) && (kind === "invalid" ? r.failed === 1 && r.processed === 0 : r.processed === 1 && r.failed === 0),
  },
  {
    id: "playlist-sync", worker: "sync", label: "YouTube playlist sync (1 event)", limit: 5000,
    modules: ["workers/youtube-playlist-sync/index.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/youtube-playlist-sync/index.ts'); const r = await m.syncEventPlaylists({ ...env, YOUTUBE_OAUTH_CLIENT_ID: 'bench-client', YOUTUBE_OAUTH_CLIENT_SECRET: 'bench-secret', YOUTUBE_OAUTH_REFRESH_TOKEN: 'bench-refresh', YOUTUBE_DAILY_QUOTA_LIMIT: '1000000' }, undefined, undefined, { runId: crypto.randomUUID(), trigger: 'scheduled', dispatchSource: 'bench' }); return { processed: r.processed, skipped: r.skipped, failed: r.failed, external_api_calls: r.external_api_calls, d1_changes: r.d1_changes, quota_stopped: r.quota_stopped }; }",
    seed: kind => {
      // limit = the CURRENT source cap (5,000 public videos in the event) with the playlist already scanned
      // (no scan page needed), so the run does the full 5,000-row diff + the playlist inserts the CURRENT code allows (3 inserts + 1 OAuth call).
      // invalid = a sync config with an empty playlist id -> not due -> nothing is fetched.
      const sources = kind === "limit" ? 5000 : 1;
      const now = seedNow();
      const remote = kind === "limit" ? 200 : 0;
      return seedBase({ sql: [
        ["INSERT INTO events (id, title, visibility_status) VALUES ('pl-event', 'Playlist event', 'public')"],
        ["INSERT INTO event_youtube_playlist_sync (event_id, playlist_id, enabled, sync_mode, sync_interval_minutes, sync_status, last_full_scan_at, updated_at) VALUES ('pl-event', ?, 1, 'append_only', 720, 'synced', ?, ?)",
          kind === "invalid" ? "" : "PLbenchplaylist", now - 100, now - 100],
        gen(sources, "videos", ["id", "primary_event_id", "submitted_by_user_id", "creator_display_name", "title", "visibility_status", "youtube_video_id", "scheduled_time", "updated_at"],
          ["'pl-video-' || i", "'pl-event'", "'bench-user'", "'Creator'", "'Playlist video ' || i", "'public'", "printf('pv%09d', i)", "? + i", "?"], now - 86400, now - 100),
        ...(remote > 0 ? [gen(remote, "event_youtube_playlist_items", ["event_id", "playlist_item_id", "youtube_video_id", "seen_at"],
          ["'pl-event'", "'pli-' || i", "printf('plr%09d', i)", "?"], now - 100)] : []),
      ] });
    },
    check: (kind, r) => Boolean(r) && r.failed === 0 && (kind === "invalid" ? r.processed === 0 && r.skipped === 1 && r.external_api_calls === 0
      : kind === "limit" ? r.processed === 1 && r.external_api_calls >= 3 && r.external_api_calls <= 4 : r.processed === 1 && r.external_api_calls >= 1 && r.external_api_calls <= 2), // OAuth token is cached per isolate
  },
  {
    // NOT measured for CPU. G18 golden: fixed seed (609) + fixed date -> deterministic daily top selection hash,
    // the MIG-0610 T01b baseline. Run twice per report to prove determinism.
    id: "g18-golden", golden: true, worker: "content", label: "G18 daily top fixed seed/date output hash", limit: 1,
    modules: ["src/lib/publicData/topNostalgicDaily.ts", "workers/json-generator/rebuild.ts"],
    run: "async (env, ctx, kind, imp) => { const d = await imp('src/lib/publicData/topNostalgicDaily.ts'); const r = await imp('workers/json-generator/rebuild.ts'); let st = 609 >>> 0; const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; const orig = Math.random; Math.random = rnd; let sel; try { const pool = Array.from({ length: 60 }, (_, i) => ({ id: 'g18-video-' + String(i + 1).padStart(2, '0') })); sel = d.resolveNostalgicDisplaySelection({ pool, previous: null, now: 1760000000, limit: 20, rehydrateById: () => [] }); } finally { Math.random = orig; } const added = await r.ensureDailyTopNostalgicShuffle(env); const q = await env.DB.prepare(\"SELECT target_type, target_id, reason, priority FROM static_rebuild_queue WHERE target_type = 'top_nostalgic'\").first(); const ids = sel.display.map(x => x.id); const payload = JSON.stringify({ seed: 609, now: 1760000000, selectionDay: sel.selectionDay, isNew: sel.isNewDaySelection, ids, enqueue: q }); const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))); return { added, hash: [...digest].map(b => b.toString(16).padStart(2, '0')).join(''), selectionDay: sel.selectionDay, ids, enqueue: q }; }",
    seed: () => seedBase({ kv: { "static:top_nostalgic_shuffle_day": null }, sql: [] }),
    check: (kind, r) => Boolean(r) && r.added === 1 && r.ids.length === 20 && /^[0-9a-f]{64}$/.test(r.hash),
  },
  {
    id: "queue-consumer-content", worker: "content", label: "Queue consumer flamenode-static-rebuild-wake (batch 10)", limit: 10,
    modules: ["workers/content-jobs/staticRebuildWakeQueue.ts", "workers/json-generator/queue.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/content-jobs/staticRebuildWakeQueue.ts'); const n = kind === 'limit' ? 10 : 1; const res = await m.handleStaticRebuildWakeQueue(batch('static_rebuild_available', kind !== 'invalid', n), env); return { n, acked: counts.acked, retried: counts.retried, processed: res.processed, failed: res.failed, retryBatch: res.retryBatch }; }",
    seed: kind => jobById("static-rebuild-queue").seed(kind === "invalid" ? "normal" : kind === "limit" ? "limit" : "normal"),
    // 10 duplicate wakes coalesce into ONE drain of the (cap 1) rebuild queue; malformed wakes are acked and do no work.
    check: (kind, r) => Boolean(r) && r.retried === 0 && r.retryBatch === false && (kind === "invalid"
      ? r.acked === 1 && r.processed === 0 : r.acked === r.n && r.processed === 1 && r.failed === 0),
  },
  {
    id: "queue-consumer-fast", worker: "fast", label: "Queue consumer flamenode-notification-wake (batch 10)", limit: 10,
    modules: ["workers/fast-jobs/notificationQueueConsumer.ts", "workers/notification-dispatcher/dispatch.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/fast-jobs/notificationQueueConsumer.ts'); const n = kind === 'limit' ? 10 : 1; const s0 = synthetic; await m.handleNotificationWakeQueue(batch('notification_available', kind !== 'invalid', n), { ...env, DISCORD_BOT_TOKEN: 'bench-bot-token' }); return { n, acked: counts.acked, retried: counts.retried, discord: synthetic - s0 }; }",
    seed: kind => jobById("notification-dispatch").seed(kind === "invalid" ? "invalid" : kind === "limit" ? "limit" : "normal"),
    // limit: 10 duplicate wakes -> one drain of MAX_NOTIFICATION_BATCH (6) rows = 12 Discord requests (lease recovery is cron-only).
    check: (kind, r) => Boolean(r) && r.retried === 0 && (kind === "invalid"
      ? r.acked === 1 && r.discord === 0 : kind === "limit" ? r.acked === 10 && r.discord === 12 : r.acked === 1 && r.discord === 2),
  },
  {
    id: "queue-consumer-sync", worker: "sync", label: "Queue consumer flamenode-youtube-sync-wake (batch 10)", limit: 10,
    modules: ["workers/sync-jobs/index.ts"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/sync-jobs/index.ts'); const n = kind === 'limit' ? 10 : 1; const s0 = synthetic; const res = await m.handleYoutubeSyncWakeQueue(batch('youtube_sync_pending', kind !== 'invalid', n), { ...env, YOUTUBE_API_KEY: 'bench-api-key' }); return { n, acked: counts.acked, retried: counts.retried, processed: res.processed, failed: res.failed, youtube: synthetic - s0 }; }",
    seed: kind => {
      // pending_only drain: YOUTUBE_PENDING_MAX_VIDEOS_PER_RUN (50) pending rows in 1 API batch.
      const n = kind === "limit" ? 60 : 1, now = seedNow();
      return seedBase({ kv: { "external-api:youtube:quota-cooldown-until": null }, sql: [
        gen(n, "videos", ["id", "submitted_by_user_id", "creator_display_name", "title", "visibility_status", "youtube_video_id", "scheduled_time", "updated_at"],
          ["'qs-video-' || i", "'bench-user'", "'Creator'", "'Pending ' || i", "'public'", "printf('qs%09d', i)", "? - i", "?"], now - 86400, now - 100),
        gen(n, "video_youtube_metadata", ["video_id", "sync_status", "view_count", "updated_at"], ["'qs-video-' || i", "'pending'", "0", "?"], now - 3600),
      ] });
    },
    check: (kind, r) => Boolean(r) && r.retried === 0 && r.failed === 0 && (kind === "invalid"
      ? r.acked === 1 && r.processed === 0 && r.youtube === 0
      : r.acked === r.n && r.youtube === 1 && r.processed === (kind === "limit" ? 50 : 1)),
  },
]);
export const jobById = id => JOBS.find(j => j.id === id);

export function parseArgs(args) {
  const opts = { dryRun: false, run: false, samples: MIN_SAMPLES, coldSamples: MIN_SAMPLES,
    warmup: 10, port: 8789, inspectorPort: 9240, out: null, probe: false, only: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => { const v = args[++i]; if (!v || v.startsWith("--")) throw Error(arg + " requires value"); return v; };
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--run") opts.run = true;
    else if (arg === "--samples") opts.samples = Number(value());
    else if (arg === "--cold-samples") opts.coldSamples = Number(value());
    else if (arg === "--warmup") opts.warmup = Number(value());
    else if (arg === "--port") opts.port = Number(value());
    else if (arg === "--inspector-port") opts.inspectorPort = Number(value());
    else if (arg === "--out") opts.out = value();
    else if (arg === "--probe") opts.probe = true;
    else if (arg === "--render") opts.render = value();
    else if (arg === "--only") opts.only = value().split(",").filter(Boolean);
    else throw Error("Unsupported argument (remote options prohibited): " + arg);
  }
  if (opts.render) return opts;
  if (opts.dryRun === opts.run) throw Error("choose exactly one of --dry-run and --run");
  for (const k of ["samples", "coldSamples", "warmup", "port", "inspectorPort"])
    if (!Number.isInteger(opts[k]) || opts[k] < 0) throw Error(k + " must be a non-negative integer");
  if (!opts.probe && (opts.samples < MIN_SAMPLES || opts.coldSamples < MIN_SAMPLES)) throw Error("50+ samples per kind required");
  if (opts.probe && !opts.run) throw Error("--probe requires --run");
  if (opts.only) for (const id of opts.only) if (!jobById(id)) throw Error("unknown job: " + id);
  if (opts.port < 1024 || opts.port > 65535 || opts.inspectorPort < 1024 ||
      opts.inspectorPort > 65535 || opts.port === opts.inspectorPort) throw Error("invalid local port");
  return opts;
}
export function limitRecommendation(oneItemMaxMs) {
  return Number.isFinite(oneItemMaxMs) && oneItemMaxMs > 0 ? Math.floor(7 / oneItemMaxMs) : null;
}
/**
 * D-14-1: judge() on the MAX, plus: when the same-run BASELINE max is >= 4 ms and the measured max is
 * 4-12 ms the number is not trustworthy -> INCONCLUSIVE (never an approval).
 */
export function backgroundVerdict(maxMs, noiseMs = 0, resolutionMs = 0) {
  const base = judge(maxMs, BUDGET_MS, { kind: "lt", noiseMs, resolutionMs });
  if (maxMs != null && noiseMs >= 4 && maxMs >= 4 && maxMs <= 12) return "INCONCLUSIVE";
  return base;
}
export function judgeBackground(values, noiseMs = 0, resolutionMs = 0) {
  const stats = summarize(values);
  return { ...stats, noiseMs, resolutionMs,
    verdict: judge(stats.max, BUDGET_MS, { kind: "lt", noiseMs, resolutionMs }) };
}

// Fixed synthetic bodies for allow-listed hosts. Active only while a named job runs; every
// other host still fails closed. Written as one function expression so it can be inlined.
export const SYNTHETIC_RESPONDER = `(url, init) => {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const host = url.hostname, p = url.pathname;
  if (host === "discord.com") {
    if (/\\/users\\/@me\\/channels$/.test(p)) return json({ id: "1000000000000000001" });
    if (/\\/channels\\/[0-9]+\\/messages$/.test(p)) return json({ id: "1000000000000000002" });
    return null;
  }
  if (host === "www.googleapis.com" && p === "/youtube/v3/videos") {
    const ids = (url.searchParams.get("id") ?? "").split(",").filter(id => id && !id.startsWith("missing-"));
    return json({ items: ids.map(id => ({ id,
      status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true },
      contentDetails: { duration: "PT3M20S" }, statistics: { viewCount: "1234" } })) });
  }
  if (host === "www.googleapis.com" && p === "/youtube/v3/playlistItems") {
    return init?.method === "POST" ? json({ id: "bench-pli-" + Math.random().toString(36).slice(2) }) : json({ items: [] });
  }
  if (host === "oauth2.googleapis.com" && p === "/token") return json({ access_token: "bench-access-token", expires_in: 3600 });
  if (host === "analyticsdata.googleapis.com" && p.endsWith(":runReport")) {
    const pages = globalThis.__ga4pages ?? [];
    let offset = 0;
    try { offset = Number(JSON.parse(init?.body ?? "{}").offset ?? 0); } catch { offset = 0; }
    const page = pages[Math.floor(offset / 10000)];
    return page === undefined ? json({ error: "bench page missing" }, 500) : new Response(page, { status: 200, headers: { "content-type": "application/json" } });
  }
  return null;
}`;

/**
 * Ephemeral Worker generated as a file. It imports the entry only after
 * assigning fetch's fail-closed trap, and only exposes localhost bench routes.
 */
export function wrapperSource(entry, rootDir = ROOT, jobs = [], buildTag = "b0") {
  const fullPath = path.join(rootDir, entry).replaceAll("\\", "/");
  return [
    "// LOCAL BENCH ONLY - MIG-0609",
    "let outbound = 0, synthetic = 0, activeJob = null;",
    "const syntheticResponse = " + SYNTHETIC_RESPONDER + ";",
    "globalThis.fetch = async (input, init) => {",
    "  const synth = activeJob && syntheticResponse(new URL(typeof input === 'string' ? input : input.url ?? String(input)), init);",
    "  if (synth) { synthetic++; return synth; }",
    "  outbound++; throw Error('external HTTP forbidden');",
    "};",
    "let entry;",
    "const getEntry = async () => entry ??= (await import(" + JSON.stringify(fullPath) + ")).default;",
    "const fixedTime = " + FIXED_TIME + ";",
    "const counts = { acked: 0, retried: 0, d1: 0 };",
    "const countingEnv = env => {",
    "  if (!env.DB) return env;",
    "  const db = new Proxy(env.DB, { get(target, prop) {",
    "    const value = target[prop];",
    "    if (typeof value !== 'function') return value;",
    "    return (...args) => { if (prop === 'prepare' || prop === 'batch' || prop === 'exec') counts.d1++; return value.apply(target, args); };",
    "  } });",
    "  return { ...env, DB: db };",
    "};",
    "// Canonical wake body (parseQueueWakeMessage); invalid = deliberately malformed, must be skipped.",
    "const wakeBody = (wakeKind, valid, i) => valid",
    "  ? { version:1, kind:wakeKind, source:'recovery', requested_at: Math.floor(fixedTime/1000), trace_id:'bench-' + i }",
    "  : { kind:'recovery', version:1 };",
    "const batch = (wakeKind, valid, n) => ({",
    "  queue: 'flamenode-bench-local',",
    "  messages: Array.from({length:n}, (_,i)=>({",
    "    id:'bench-'+i, timestamp:new Date(fixedTime),",
    "    body:wakeBody(wakeKind, valid, i), attempts:1,",
    "    ack(){ counts.acked++; }, retry(){ counts.retried++; }",
    "  })), ackAll(){}, retryAll(){}",
    "});",
    "// Literal import() calls so wrangler/esbuild bundles each job module; evaluated lazily (cold cost lands in the job run).",
    "const IMPORTERS = {",
    ...[...new Set(jobs.flatMap(j => j.modules))].map(m => "  " + JSON.stringify(m) + ": () => import(" + JSON.stringify(path.join(rootDir, m).replaceAll("\\", "/")) + "),"),
    "};",
    "const imp = rel => { if (!IMPORTERS[rel]) throw Error('undeclared job module ' + rel); return IMPORTERS[rel](); };",
    "const JOB_RUNNERS = {",
    ...jobs.map(j => "  " + JSON.stringify(j.id) + ": " + j.run + ","),
    "};",
    "const prepGa4 = async spec => {",
    "  if (!globalThis.__ga4) {",
    "    const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);",
    "    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey)); let bin = ''; for (const b of der) bin += String.fromCharCode(b);",
    "    globalThis.__ga4 = { pem: '-----BEGIN PRIVATE KEY-----\\n' + btoa(bin).replace(/.{64}/g, '$&\\n') + '\\n-----END PRIVATE KEY-----' };",
    "  }",
    "  const names = ['last_2_days', 'last_5', 'last_7', 'last_30'], rows = [];",
    "  for (let i = 1; i <= spec.videos; i++) names.forEach((name, k) => rows.push({ dimensionValues: [{ value: (spec.unknown ? 'unknown-' : 'ga-video-') + i }, { value: name }], metricValues: [{ value: String((1000 - i) % 997 + 10 + k) }] }));",
    "  const page = r => JSON.stringify({ dimensionHeaders: [{ name: 'customEvent:video_id' }, { name: 'dateRange' }], metricHeaders: [{ name: 'eventCount' }], rows: r, rowCount: spec.videos });",
    "  const pages = []; for (let o = 0; o < rows.length; o += 10000) pages.push(page(rows.slice(o, o + 10000)));",
    "  if (rows.length === 0 || rows.length % 10000 === 0) pages.push(page([]));",
    "  globalThis.__ga4pages = pages;",
    "};",
    "const seedEnv = async (env, spec) => {",
    "  for (const t of spec.clearTables ?? []) { try { await env.DB.prepare('DELETE FROM ' + JSON.stringify(t)).run(); } catch (e) { throw Error('clear ' + t + ': ' + (e?.message ?? e)); } }",
    "  if (spec.clearR2 !== undefined) { let c; do { const page = await env.R2.list({ prefix: spec.clearR2, limit: 500, cursor: c }); if (page.objects.length) await env.R2.delete(page.objects.map(o => o.key)); c = page.truncated ? page.cursor : undefined; } while (c); }",
    "  for (const [k, v] of Object.entries(spec.r2Json ?? {})) await env.R2.put(k, v);",
    "  for (let i = 0; i < (spec.r2Count ?? 0); i++) await env.R2.put(spec.r2Prefix + (spec.r2Hex ? i.toString(16).padStart(64, '0') : String(i)) + spec.r2Suffix, 'x');",
    "  for (const [k, v] of Object.entries(spec.kv ?? {})) { if (v === null) await env.KV.delete(k); else await env.KV.put(k, v); }",
    "  if (spec.ga4) await prepGa4(spec.ga4);",
    "  const stmts = spec.sql ?? [];",
    "  for (let i = 0; i < stmts.length; i += 40) { try { await env.DB.batch(stmts.slice(i, i + 40).map(([q, ...b]) => env.DB.prepare(q).bind(...b))); } catch (e) { throw Error('seed chunk ' + i + ' (' + stmts.slice(i, i + 40).map(x => x[0].slice(0, 60)).join(' | ').slice(0, 300) + '): ' + (e?.message ?? e)); } }",
    "};",
    "export default { async fetch(req, env, ctx) {",
    "  const url = new URL(req.url);",
    "  if (url.pathname === '/__bench/ping') return new Response('ready');",
    "  if (url.pathname === '/__bench/build') return new Response(" + JSON.stringify(buildTag) + ");",
    "  if (url.pathname === '/__bench/seed' && req.method === 'POST') {",
    "    try { const spec = await req.json(); await seedEnv(env, spec); return Response.json({ ok: true }); }",
    "    catch (e) { return Response.json({ ok: false, reason: 'seed_failed', error: String(e?.message ?? e).slice(0, 300) }, { status: 500 }); }",
    "  }",
    "  if (url.pathname === '/__bench/job' && req.method === 'POST') {",
    "    const id = url.searchParams.get('job') ?? '';",
    "    const runner = JOB_RUNNERS[id];",
    "    if (!runner) return Response.json({ ok: false, reason: 'unknown_job' }, { status: 404 });",
    "    const before = outbound, beforeSyn = synthetic;",
    "    counts.acked = 0; counts.retried = 0; counts.d1 = 0;",
    "    activeJob = id;",
    "    try {",
    "      const result = await runner(countingEnv(env), ctx, url.searchParams.get('kind') || 'normal', imp);",
    "      if (outbound > before) return Response.json({ ok: false, reason: 'external_blocked', outbound: outbound - before }, { status: 502 });",
    "      return Response.json({ ok: true, outbound: 0, synthetic: synthetic - beforeSyn, d1: counts.d1, result: result ?? null });",
    "    } catch (e) { return Response.json({ ok: false, reason: 'job_failed', error: String(e?.stack ?? e).slice(0, 600), outbound: outbound - before }, { status: 500 }); }",
    "    finally { activeJob = null; }",
    "  }",
    "  if (url.pathname === '/__bench/noop') return new Response('ok');",
    "  if (url.pathname === '/__bench/d1') { const n = Number(url.searchParams.get('n') || 1); for (let i = 0; i < n; i++) await env.DB.prepare('SELECT 1 AS x').first(); return new Response('ok'); }",
    "  if (req.method !== 'POST') return new Response('Not found', {status:404});",
    "  const before = outbound;",
    "  counts.acked = 0; counts.retried = 0; counts.d1 = 0;",
    "  const benchEnv = countingEnv(env);",
    "  try {",
    "    const current = await getEntry();",
    "    const kind = url.searchParams.get('kind') || 'normal';",
    "    if (url.pathname === '/__bench/scheduled') {",
    "      await current.scheduled({ cron:url.searchParams.get('cron') || '0 * * * *', scheduledTime:fixedTime, type:'scheduled' }, benchEnv, ctx);",
    "    } else if (url.pathname === '/__bench/queue') {",
    "      const body = await req.json();",
    "      if (!Number.isInteger(body.count) || body.count < 0 || body.count > 10) return new Response('invalid count', {status:400});",
    "      await current.queue(batch(url.searchParams.get('wake') || '', kind !== 'invalid', body.count), benchEnv, ctx);",
    "    } else return new Response('Not found', {status:404});",
    "    if (outbound > before) return Response.json({ok:false, reason:'external_blocked', outbound:outbound-before}, {status:502});",
    "    return Response.json({ok:true, outbound:0, acked:counts.acked, retried:counts.retried, d1:counts.d1});",
    "  } catch { return Response.json({ok:false, reason:'job_failed', outbound:outbound-before}, {status:500}); }",
    "} };",
  ].join("\n");
}
export function seedForKind(scenario, kind) {
  if (scenario.kind === "scheduled") {
    return { path: "/__bench/scheduled?cron=" + encodeURIComponent(scenario.cron) +
      "&kind=" + kind, body: "{}" };
  }
  const count = kind === "limit" ? scenario.inputMax : 1;
  return { path: "/__bench/queue?kind=" + kind + "&wake=" + scenario.wakeKind, body: JSON.stringify({count}), count };
}
/**
 * A queue sample is valid only if the consumer really ran: valid wakes touch D1 and are acked;
 * malformed wakes are acked without any D1 statement. HTTP 200 alone proves nothing.
 */
export function validateSample(spec, status, responseText) {
  if (status !== 200) return false;
  let body;
  try { body = JSON.parse(responseText); } catch { return false; }
  if (body?.ok !== true || body.outbound !== 0) return false;
  if (!spec.path.startsWith("/__bench/queue")) return Number.isInteger(body.d1);
  if (body.retried !== 0 || body.acked !== spec.count) return false;
  return spec.path.includes("kind=invalid") ? body.d1 === 0 : body.d1 > 0;
}
export function cpuFromProfile(profile, initialResolutionMs = 0.1) {
  const names = new Map(profile.nodes.map(n => [n.id, n.callFrame.functionName]));
  let cpuMs = 0, resolutionMs = initialResolutionMs;
  profile.samples.forEach((id, i) => {
    if (names.get(id) === "(idle)") return;
    const ms = profile.timeDeltas[i] / 1000;
    cpuMs += ms;
    resolutionMs = Math.max(resolutionMs, ms);
  });
  return {cpuMs, resolutionMs};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const progress = msg => process.stderr.write("[" + ((Date.now() - T0) / 1000).toFixed(0) + "s] " + msg + "\n");
function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {stdio:"ignore"});
  else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
}

async function localTarget(worker, opts) {
  const require = createRequire(path.join(ROOT,"package.json"));
  const wranglerBin = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
  const WebSocket = createRequire(require.resolve("wrangler/package.json"))("ws");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-background-bench-"));
  const state = path.join(workDir, "state");
  const mig = await materializeD1CompatibleMigrations(path.join(ROOT,"migrations"));
  const toml = path.join(workDir, "wrangler.toml");
  const workerPath = path.join(workDir, "worker.mjs");
  let child, socket, seq = 0, log = "", build = 0;
  const pending = new Map();
  const cleanup = async () => {
    try { socket?.terminate(); } catch { /* ignore */ }
    kill(child);
    await sleep(1000);
    fs.rmSync(workDir, {recursive:true, force:true, maxRetries:10, retryDelay:300});
  };
  try {
    fs.writeFileSync(workerPath, wrapperSource(worker.entry, ROOT, JOBS.filter(j => j.worker === worker.id), "b0"));
    fs.writeFileSync(toml, [
      'name = "flamenode-background-bench-local"',
      'main = "worker.mjs"',
      'compatibility_date = "2025-01-09"',
      'compatibility_flags = ["nodejs_compat"]',
      "[vars]", 'BUILD_COMMIT_SHA = "'+"a".repeat(40)+'"',
      "[[d1_databases]]", 'binding = "DB"', 'database_name = "flamenode_db"',
      'database_id = "00000000-0000-0000-0000-000000000000"',
      "migrations_dir = " + JSON.stringify(mig.outputDir.replaceAll("\\","/")),
      "[[r2_buckets]]", 'binding = "R2"', 'bucket_name = "flamenode-bench-local"',
      "[[kv_namespaces]]", 'binding = "KV"', 'id = "00000000-0000-0000-0000-000000000000"',
    ].join("\n"));
    progress("migrations apply (" + worker.id + ")");
    const apply = spawnSync(process.execPath, [wranglerBin,"d1","migrations","apply","flamenode_db",
      "--local","--config",toml,"--persist-to",state],
      {cwd:workDir, encoding:"utf8", timeout:120000});
    if (apply.status !== 0) throw Error("local D1 migration failed: "+String(apply.stderr).slice(-500));
    const base = "http://127.0.0.1:" + opts.port;
    child = spawn(process.execPath, [wranglerBin,"dev","--local","--config",toml,
      "--persist-to",state,"--port",String(opts.port),"--ip","127.0.0.1",
      "--inspector-port",String(opts.inspectorPort)], {
      cwd:workDir, env:{...process.env,WRANGLER_SEND_METRICS:"false"},stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32" });
    child.stdout.on("data", d => {log+=d.toString().slice(-400);});
    child.stderr.on("data", d => {log+=d.toString().slice(-400);});
    progress("wrangler dev start (" + worker.id + ")");
    let ready = false;
    for (let n=0;n<300;n++) {
      try {ready=(await fetch(base+"/__bench/ping",{signal:AbortSignal.timeout(5000)})).ok;} catch { /* local startup */ }
      if (ready) break;
      await sleep(150);
    }
    if (!ready) throw Error("localhost Wrangler startup failed: "+log.slice(-500));
    const call=(method, params={}, timeoutMs=60000)=>new Promise((resolve,reject)=>{
      const id=++seq;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error("inspector call timed out: "+method));},timeoutMs);
      pending.set(id,data=>{clearTimeout(timer);resolve(data);});
      socket.send(JSON.stringify({id,method,params}));
    });
    const connect = async () => {
      try {socket?.terminate();} catch { /* ignore */ }
      for(let n=0;n<200;n++) {
        try {
          const targets=await (await fetch("http://127.0.0.1:"+opts.inspectorPort+"/json",{signal:AbortSignal.timeout(5000)})).json();
          if (!targets[0]?.webSocketDebuggerUrl) throw Error("no local inspector");
          socket = new WebSocket(targets[0].webSocketDebuggerUrl);
          await new Promise((ok,err)=>{const t=setTimeout(()=>err(Error("inspector ws open timeout")),5000);socket.once("open",()=>{clearTimeout(t);ok();});socket.once("error",e=>{clearTimeout(t);err(e);});});
          socket.on("message", raw => {
            const data=JSON.parse(raw.toString()), cb=pending.get(data.id);
            if(cb) {pending.delete(data.id);cb(data);}
          });
          const enabled=await call("Profiler.enable",{},8000);
          if (enabled.error) throw Error(JSON.stringify(enabled.error));
          await call("Profiler.setSamplingInterval",{interval:100},8000);
          return;
        } catch {try {socket?.terminate();} catch { /* ignore */ } await sleep(300);}
      }
      throw Error("local V8 inspector unavailable");
    };
    progress("worker ready; connecting inspector");
    await connect();
    progress("inspector connected");
    const run=async(spec)=>{
      const started=await call("Profiler.start");
      if (started.error) throw Error("V8 sampling start failed: "+JSON.stringify(started.error));
      const r=await fetch(base+spec.path,{method:"POST",body:spec.body,
        headers:{"content-type":"application/json"},signal:AbortSignal.timeout(120000)});
      const responseText=await r.text();
      const result=await call("Profiler.stop");
      if (result.error || !result.result?.profile) throw Error("V8 sampling failed: "+JSON.stringify(result).slice(0,300));
      return {status:r.status, bytes:responseText.length, responseText,
        ...cpuFromProfile(result.result.profile)};
    };
    const reload=async()=>{
      build++;
      const tag="b"+build;
      fs.writeFileSync(workerPath, wrapperSource(worker.entry, ROOT, JOBS.filter(j => j.worker === worker.id), tag));
      for(let n=0;n<300;n++) {
        await sleep(100);
        try { if ((await (await fetch(base+"/__bench/build")).text())===tag) break; } catch { /* reloading */ }
        if (n===299) throw Error("local Worker reload did not complete");
      }
      await connect();
    };
    const seed=async(spec)=>{
      const r=await fetch(base+"/__bench/seed",{method:"POST",body:JSON.stringify(spec),headers:{"content-type":"application/json"},signal:AbortSignal.timeout(120000)});
      const text=await r.text();
      if(!r.ok) throw Error("seed failed: "+text.slice(0,400));
    };
    return {run,reload,seed,cleanup,wrangler:spawnSync(process.execPath,[wranglerBin,"--version"],
      {encoding:"utf8"}).stdout.trim()};
  } catch(error) {
    await cleanup();
    throw error;
  } finally {
    fs.rmSync(mig.workspace,{recursive:true,force:true});
  }
}
/** A job sample is valid only if the real job ran its seeded input (see each job's check()). */
export function validateJobSample(job, kind, status, responseText) {
  if (status !== 200) return false;
  let body;
  try { body = JSON.parse(responseText); } catch { return false; }
  if (body?.ok !== true || body.outbound !== 0) return false;
  try { return job.check(kind, body.result) === true; } catch { return false; }
}
const d1Of = text => { try { return Number(JSON.parse(text).d1) || 0; } catch { return 0; } };

async function measureJobs(target, w, opts, noiseMs, results) {
  for (const job of JOBS.filter(j => !j.golden && j.worker === w.id && (!opts.only || opts.only.includes(j.id)))) {
    progress("job " + job.id + " (" + w.id + ")");
    const rows = [];
    const sample = async (kind, kindLabel = kind, reload = false) => {
      const spec = { path: "/__bench/job?job=" + job.id + "&kind=" + kind, body: "{}" };
      if (reload) await target.reload();
      await target.seed(job.seed(kind));
      const r = await target.run(spec);
      return { kind: kindLabel, cpuMs: r.cpuMs, status: r.status, bytes: r.bytes, d1: d1Of(r.responseText),
        unexpected: !validateJobSample(job, kind, r.status, r.responseText), text: r.responseText };
    };
    for (const kind of ["normal", "limit", "invalid"]) {
      progress("  " + job.id + " " + kind);
      for (let i = 0; i < opts.warmup; i++) await sample(kind);
      for (let i = 0; i < opts.samples; i++) rows.push(await sample(kind));
    }
    progress("  " + job.id + " cold");
    for (let i = 0; i < opts.coldSamples; i++) rows.push(await sample("normal", "cold", true));
    const firstBad = rows.find(r => r.unexpected);
    results.push({ id: job.id, worker: w.id, label: job.label, limitItems: job.limit, noiseMs,
      summary: aggregate(rows, { runtimeClass: "S3", resolutionMs: 0.1, noiseMs }),
      validMeasure: !firstBad,
      firstInvalidSample: firstBad ? { kind: firstBad.kind, status: firstBad.status, body: firstBad.text.slice(0, 500) } : null });
  }
}

const fmt = v => (v == null ? "-" : Number(v).toFixed(2));
/**
 * Local D1 simulator cost, from the calibration routes: per trivial read = (p50(17) - p50(1)) / 16 and the
 * fixed per-request overhead of the bench route = p50(1) - per read. Mean of the workers' calibrations.
 */
export function d1SimulatorCost(calibration = []) {
  const per = [];
  for (const w of new Set(calibration.map(c => c.worker))) {
    const one = calibration.find(c => c.worker === w && c.n === 1), many = calibration.find(c => c.worker === w && c.n === 17);
    if (one?.p50 != null && many?.p50 != null) per.push({ read: (many.p50 - one.p50) / 16, overhead: one.p50 - (many.p50 - one.p50) / 16 });
  }
  if (per.length === 0) return null;
  const mean = key => per.reduce((sum, x) => sum + x[key], 0) / per.length;
  return { perStatementMs: mean("read"), requestOverheadMs: mean("overhead") };
}
/** Markdown for BACKGROUND_CPU.md (U03) from a report produced by --run --out. */
export function renderMarkdown(report) {
  const kinds = report.kinds ?? ["normal", "limit", "invalid", "cold"];
  const rows = [...(report.jobs ?? []), ...(report.triggers ?? [])];
  const sim = d1SimulatorCost(report.calibration);
  const lines = [];
  lines.push("| Job | kind | n | p50 (ms) | p95 (ms) | max (ms) | unexpected | max D1 stmts |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of rows) for (const kind of kinds) {
    const k = r.summary.kinds[kind];
    lines.push("| `" + r.id + "` | " + kind + " | " + k.n + " | " + fmt(k.p50) + " | " + fmt(k.p95) + " | " + fmt(k.max) + " | " + k.unexpectedStatus + " | " + k.maxD1Statements + " |");
  }
  lines.push("");
  lines.push("| Job | worker | limit (items) | baseline max / noise (ms) | 1-item max (ms) | overall max (ms) | verdict | cap = floor(7 / 1-item max) |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |");
  for (const r of rows) {
    const one = r.summary.kinds.normal.max, overall = r.summary.overallMax;
    const verdict = r.validMeasure ? backgroundVerdict(overall, r.noiseMs, 0.1) : "INVALID";
    const cap = r.validMeasure && overall != null && overall >= BUDGET_MS ? limitRecommendation(one) : null;
    lines.push("| `" + r.id + "` | " + r.worker + " | " + (r.limitItems ?? "-") + " | " + fmt(r.noiseMs) + " | " + fmt(one) + " | " + fmt(overall) + " | **" + verdict + "** | " + (cap == null ? "-" : cap) + " |");
  }
  if (sim) {
    lines.push("");
    lines.push("Local D1 simulator calibration: " + fmt(sim.perStatementMs) + " ms CPU per trivial `SELECT 1`, " + fmt(sim.requestOverheadMs) + " ms fixed bench-request overhead (p50 of n=1 and n=17 reads, mean of " + new Set(report.calibration.map(c => c.worker)).size + " workers).");
  }
  return lines.join("\n");
}

function wranglerVersion() {
  const require = createRequire(path.join(ROOT, "package.json"));
  const bin = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
  return spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" }).stdout.trim();
}

export async function main(args) {
  const opts = parseArgs(args), scenarios = plan();
  if (opts.render) { console.log(renderMarkdown(JSON.parse(fs.readFileSync(opts.render, "utf8")))); return; }
  if (opts.dryRun) {
    const sample = Array.from({ length: MIN_SAMPLES }, (_, i) => i / 10);
    console.log("MIG-0609 local-only dry-run: no Worker/D1/R2/inspector/network started");
    for (const item of scenarios) console.log("  " + item.id + " " + (item.cron ?? item.queue));
    for (const job of JOBS.filter(j => !j.golden)) console.log("  job " + job.id + " (" + job.worker + ", limit " + job.limit + ") normal/limit/invalid/cold");
    console.log("synthetic-only verdict=" + judgeBackground(sample, 0.2, 0.1).verdict);
    return;
  }
  const results = [], jobResults = [];
  let g18 = null;
  const calibration = [];
  for (const w of WORKERS) {
    if (opts.only && !JOBS.some(j => j.worker === w.id && opts.only.includes(j.id))) continue;
    progress("worker " + w.id);
    const target = await localTarget(w, opts);
    try {
      const baseline = [];
      for (let i = 0; i < opts.warmup; i++) await target.run({ path: "/__bench/noop", body: "{}" });
      for (let i = 0; i < (opts.probe ? 3 : opts.samples); i++) baseline.push((await target.run({ path: "/__bench/noop", body: "{}" })).cpuMs);
      const noiseMs = summarize(baseline).max ?? 0;
      if (!opts.probe) {
        for (const n of [1, 17]) {
          const runs = [];
          for (let i = 0; i < opts.warmup; i++) await target.run({ path: "/__bench/d1?n=" + n, body: "{}" });
          for (let i = 0; i < 30; i++) runs.push((await target.run({ path: "/__bench/d1?n=" + n, body: "{}" })).cpuMs);
          const st = summarize(runs);
          calibration.push({ worker: w.id, route: "d1-trivial-reads", n, p50: st.p50, max: st.max });
        }
      }
      if (opts.probe) {
        for (const job of JOBS.filter(j => j.worker === w.id && opts.only?.includes(j.id))) {
          for (const kind of ["normal", "limit", "invalid"]) {
            progress("probe " + job.id + " " + kind + ": seed");
            await target.seed(job.seed(kind));
            progress("probe " + job.id + " " + kind + ": run");
            const r = await target.run({ path: "/__bench/job?job=" + job.id + "&kind=" + kind, body: "{}" });
            console.log(job.id, kind, "cpuMs=" + r.cpuMs.toFixed(2), "valid=" + validateJobSample(job, kind, r.status, r.responseText), r.responseText.slice(0, 700));
          }
        }
        continue;
      }
      if (!opts.only) {
        const scenariosForWorker = scenarios.filter(s => s.worker === w.id && s.kind === "scheduled");
        progress("generic trigger probes (" + w.id + ")");
        const rows = new Map(scenariosForWorker.map(s => [s.id, []]));
        for (const s of scenariosForWorker) {
          for (const kind of ["normal", "limit", "invalid"]) {
            const spec = seedForKind(s, kind);
            for (let i = 0; i < opts.warmup; i++) await target.run(spec);
            for (let i = 0; i < opts.samples; i++) {
              const r = await target.run(spec);
              rows.get(s.id).push({ kind, cpuMs: r.cpuMs, status: r.status,
                bytes: r.bytes, d1: d1Of(r.responseText), unexpected: !validateSample(spec, r.status, r.responseText) });
            }
          }
        }
        for (let i = 0; i < opts.coldSamples; i++) {
          for (const s of scenariosForWorker) {
            await target.reload();
            const spec = seedForKind(s, "normal");
            const r = await target.run(spec);
            rows.get(s.id).push({ kind: "cold", cpuMs: r.cpuMs, status: r.status,
              bytes: r.bytes, d1: d1Of(r.responseText), unexpected: !validateSample(spec, r.status, r.responseText) });
          }
        }
        for (const [id, samples] of rows) {
          results.push({ id, worker: w.id, noiseMs, summary: aggregate(samples, { runtimeClass: "S3", resolutionMs: 0.1, noiseMs }),
            validMeasure: samples.every(s => !s.unexpected) });
        }
      }
      await measureJobs(target, w, opts, noiseMs, jobResults);
      if (w.id === "content" && !opts.only) {
        const golden = jobById("g18-golden"), runs = [];
        for (let i = 0; i < 2; i++) {
          await target.seed(golden.seed("normal"));
          const r = await target.run({ path: "/__bench/job?job=g18-golden&kind=normal", body: "{}" });
          runs.push(validateJobSample(golden, "normal", r.status, r.responseText) ? JSON.parse(r.responseText).result : null);
        }
        g18 = runs[0] && runs[1] && runs[0].hash === runs[1].hash ? { ...runs[0], runs: 2, deterministic: true, seed: 609, nowSec: 1760000000 } : { deterministic: false, runs };
      }
    } finally { await target.cleanup(); }
  }
  if (opts.probe) return;
  const report = { label: "LOCAL ONLY - NOT PRODUCTION", host: {
    node: process.version, os: process.platform, arch: os.arch(), osRelease: os.release(),
    cpu: os.cpus()[0]?.model ?? "unknown", cpuCount: os.cpus().length, wrangler: wranglerVersion() },
  note: "triggers[] = idle cron end-to-end (no due work); jobs[] = U02 named per-job fixtures incl. the 3 queue consumers; calibration[] = local D1 simulator cost per trivial read",
  kinds: ["normal", "limit", "invalid", "cold"], minSamples: MIN_SAMPLES, samples: opts.samples, coldSamples: opts.coldSamples,
  triggers: results, jobs: jobResults, g18, calibration };
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if ([...results, ...jobResults].some(r => !r.validMeasure) || (!opts.only && g18?.deterministic !== true)) process.exitCode = 2;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1); });

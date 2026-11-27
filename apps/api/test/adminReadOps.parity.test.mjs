import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/personalSeed.mjs";
import { insert } from "./support/personalHarness.mjs";

// MIG-0626 parity: the same seed is read by CURRENT's loaders (the real src/** functions plus the drizzle queries
// copied from app/(admin)/admin/**/page.tsx) and by the Hono /api/admin-read/* routes.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { and, asc, desc, eq, gt, gte, inArray, isNull, like, lte, lt, or, sql } = await import("drizzle-orm");
  const S = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const { getLatestPublishedMajorTerms, termsReacceptRequiredCondition } = await import("../../../src/lib/terms/reaccept.ts");
  const { getAuditLogSettings } = await import("../../../src/lib/audit/settings.ts");
  const { drizzleNotificationCategoryCondition } = await import("../../../src/lib/notifications/display.ts");
  const { lookupNotificationRecipients } = await import("../../../src/lib/notifications/recipient.ts");
  const { TERMINAL_NOTIFICATION_FAILURE_STATUSES } = await import("@flamenode/domain/admin");
  const { ADMIN_NOTIFICATION_CATEGORY_OPTIONS } = await import("../../../src/lib/notifications/types.ts");
  const { normalizeVideoVisibilityFilter, videoVisibilityStatusesForFilter } = await import(
    "../../../src/lib/admin/videoVisibilityLabels.ts"
  );

  const T0 = 1_700_000_000;
  const sqlite = createSqlite();
  seed(sqlite);
  const ins = (table, row) => insert(sqlite, table, row);
  const refDb = drizzle(async (text, params, method) => {
    const statement = sqlite.prepare(text);
    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }
    statement.setReturnArrays(true); // duplicate column names (id, id) must not collapse
    const rows = statement.all(...params).map((row) => [...row]);
    return { rows: method === "get" ? rows[0] : rows };
  });
  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));
  const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));

  // ---------------- admin-only seed ----------------
  ins("user", { id: "u_mod", name: "Mod", email: "mod@example.test", role: "moderator", created_at: T0 });
  ins("session", { sessionToken: "tok-mod", userId: "u_mod", expires: Date.now() + 3_600_000 });
  const ADMIN = "tok-carol"; // personalSeed: carol is the admin

  for (let i = 0; i < 56; i += 1) {
    ins("announcements", {
      id: `ann-${String(i).padStart(2, "0")}`,
      title: `Announcement ${i}`,
      body: `Body ${i}`,
      severity: i % 3 === 0 ? "warning" : "info",
      is_published: i % 2,
      publish_at: i % 4 === 0 ? T0 + i : null,
      expire_at: i % 5 === 0 ? T0 + 9999 : null,
      target_audience: ["all", "creators", "admins"][i % 3],
      created_by_user_id: "u_carol",
      created_at: T0 + i * 7,
      updated_at: T0 + i * 11,
    });
  }
  ins("terms_versions", { id: "D1", version_label: "draft-1", body_markdown: "# draft", status: "draft", severity: "minor", published_at: null, created_by_user_id: "u_carol", updated_at: 4000 });
  ins("terms_versions", { id: "A1", version_label: "arch-1", body_markdown: "# arch", status: "archived", severity: "major", published_at: 500, created_by_user_id: "u_carol", updated_at: 600 });
  for (let i = 0; i < 22; i += 1) {
    ins("terms_versions", { id: `DX${i}`, version_label: `dx-${i}`, body_markdown: "x", status: "draft", severity: "minor", published_at: null, created_by_user_id: "u_carol", updated_at: 5000 + i });
  }

  ins("events", { id: "ev3", title: "Event Three", start_time: 300, updated_at: T0 + 30 });
  ins("events", { id: "ev4", title: "Event Four", start_time: 200, updated_at: T0 + 40 });
  ins("events", { id: "ev5", title: "Event Five", start_time: 200, updated_at: T0 + 50 });
  for (const [id, name, slug, type, vis, order] of [
    ["g1", "Series A", "series-a", "series", "public", 2],
    ["g2", "Genre B", "genre-b", "genre", "private", 1],
    ["g3", "Other C", "other-c", "other", "archived", 1],
    ["g4", "Empty D", "empty-d", "series", "public", 3],
  ]) {
    ins("event_groups", { id, name, slug, group_type: type, visibility_status: vis, sort_order: order, description: `${name} desc`, icon_url: null, accent_color: "#123456", created_at: T0, updated_at: T0 + order });
  }
  for (const [g, e] of [["g1", "ev3"], ["g1", "ev4"], ["g1", "ev5"], ["g1", "ev2"], ["g2", "ev1"], ["g3", "ev3"]]) {
    ins("event_group_events", { event_group_id: g, event_id: e });
  }
  for (let i = 0; i < 3; i += 1) {
    ins("event_templates", { id: `tpl-${i}`, name: `Template ${i}`, description: i === 1 ? null : `desc ${i}`, source_event_id: i === 0 ? "ev1" : null, settings_json: JSON.stringify({ version: 1, n: i }), created_by_user_id: "u_carol", created_at: T0, updated_at: T0 + i * 5 });
  }

  // audit logs (distinct created_at except where noted by tests)
  const audits = [
    ["a1", "videos", "v1", "UPDATE", "u_carol", "restorable", T0 + 10, { title: "a" }, { title: "b" }],
    ["a2", "videos", "v1", "UPDATE", "u_alice", "restored", T0 + 20, { title: "b" }, { title: "c" }],
    ["a3", "events", "ev1", "CREATE", "u_carol", "not_restorable", T0 + 30, null, { id: "ev1" }],
    ["a4", "users", "u_bob", "STATUS_CHANGE", "u_ghost", "expired", T0 + 40, { role: "user" }, { role: "admin" }],
    ["a5", "videos", "v1", "DELETE", "u_carol", "blocked", T0 + 50, { title: "c" }, null],
    ["a6", "x_users", "x1", "MERGE", "u_alice", "failed", T0 + 60, null, null],
    ["a7", "system_settings", "default", "SYSTEM", "u_carol", "not_restorable", T0 + 70, null, { audit_x: 1 }],
    ["a8", "videos", "v2", "RESTORE", "u_bob", "restorable", T0 + 80, { t: 1 }, { t: 2 }],
  ];
  for (const [id, table, target, op, actor, rs, at, before, after] of audits) {
    ins("audit_logs", {
      id, table_name: table, target_id: target, operation: op, actor_user_id: actor, restore_status: rs, created_at: at,
      before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null,
      changed_keys_json: before && after ? JSON.stringify(Object.keys(after)) : null,
      actor_snapshot_json: JSON.stringify({ discord_name: `d-${actor}` }), reason: `reason ${id}`, context: `ctx ${id}`,
      payload_size_bytes: 10, expires_at: rs === "restorable" ? T0 + 9999 : null,
    });
  }
  ins("audit_restore_runs", { id: "rr1", audit_log_id: "a1", executed_by_user_id: "u_carol", reason: "r1", status: "success", executed_at: T0 + 100 });
  ins("audit_restore_runs", { id: "rr2", audit_log_id: "a-gone", executed_by_user_id: "u_carol", reason: "r2", status: "failed", error_message: "boom", executed_at: T0 + 200 });
  ins("audit_restore_runs", { id: "rr3", audit_log_id: "a2", executed_by_user_id: "u_alice", reason: "r3", status: "success", executed_at: T0 + 150 });

  const nowS = Math.floor(Date.now() / 1000);
  const notif = (id, type, status, o = {}) =>
    ins("notification_outbox", {
      id, type, status, recipient_user_id: o.recipient === undefined ? "u_alice" : o.recipient,
      payload_json: JSON.stringify({ message: `msg ${id}`, ...(o.payload ?? {}) }), event_id: o.event ?? null,
      attempt_count: o.attempts ?? 0, next_attempt_at: o.next ?? null, lease_expires_at: o.lease ?? null,
      last_error: o.error ?? null, dedupe_key: o.dedupe ?? null, created_at: o.at,
    });
  notif("n1", "video_approved", "pending", { at: T0 + 1 });
  notif("n2", "slot_force_released", "processing", { at: T0 + 2, lease: nowS - 100 });
  notif("n3", "x_id_approved", "processing", { at: T0 + 3, lease: nowS + 1000 });
  notif("n4", "discord_webhook", "failed", { at: T0 + 4, recipient: null, error: "http 500", attempts: 3, event: "ev1" });
  notif("n5", "video_pending", "dead_letter", { at: T0 + 5, error: "gone", attempts: 4 });
  notif("n6", "mystery_type", "sent", { at: T0 + 6, dedupe: "dd-1", payload: { needle: "findme" } });
  notif("n7", "event_created", "cancelled", { at: T0 + 7, recipient: "u_missing" });
  notif("n8", "chapter_added", "processing", { at: T0 + 8, lease: null });
  notif("n9", "announcement_x", "pending", { at: T0 + 9, recipient: "u_bob" });
  for (let i = 0; i < 105; i += 1) notif(`nb${i}`, "video_bulk", "sent", { at: T0 + 100 + i });

  sqlite.exec("DELETE FROM video_youtube_metadata"); // the personal seed's rows are not part of this scenario
  const ytMeta = (videoId, o) =>
    ins("video_youtube_metadata", { video_id: videoId, view_count: o.views ?? 0, sync_status: o.status, synced_at: o.synced ?? null, sync_error: o.error ?? null, youtube_privacy_status: o.privacy ?? "public", youtube_availability_status: o.avail ?? "available", duration_seconds: o.dur ?? 60, updated_at: o.updated });
  ytMeta("va1", { status: "synced", synced: nowS - 100, updated: T0 + 1 });
  ytMeta("va2", { status: "failed", error: "quota", synced: nowS - 20 * 86400, updated: T0 + 2, privacy: "private", avail: "unavailable" });
  ytMeta("va3", { status: "pending", synced: null, updated: T0 + 3, privacy: "unlisted" });
  ytMeta("va4", { status: "synced", synced: nowS - 30 * 86400, updated: T0 + 4, views: 99 });
  ins("videos", { id: "vnoyt", title: "No YT", submitted_by_user_id: "u_zed_user", creator_display_name: "n", youtube_video_id: null, visibility_status: "pending", created_at: T0 + 5000 });
  ins("videos", { id: "vemptyyt", title: "Empty YT", submitted_by_user_id: "u_zed_user", creator_display_name: "n", youtube_video_id: "", visibility_status: "private", created_at: T0 + 5001 });

  async function call(path, token, options = {}) {
    const d1 = options.d1 ?? createD1(sqlite);
    const response = await app.request(path, { method: options.method ?? "GET", headers: token ? cookie(token) : {} }, { DB: d1, ...(options.env ?? {}) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : null, stats: d1.stats };
  }
  const get = async (path) => {
    const r = await call(`/api/admin-read${path}`, ADMIN);
    assert.equal(r.status, 200, path + " " + r.text.slice(0, 200));
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.equal(r.stats.writes, 0, `${path}: GET must not write`);
    assert.ok(r.stats.maxBinds <= 100, `${path}: ${r.stats.maxBinds} binds`);
    assert.ok(r.stats.statements <= 3, `${path}: ${r.stats.statements} D1 statements (ZERO_1102 S2 allows 3 incl. the session lookup)`);
    assert.ok(r.text.length <= 64 * 1024, `${path}: ${r.text.length} bytes > 64 KiB`);
    return r;
  };

  // ---------------- CURRENT reference loaders ----------------
  async function refAnnouncements(sp) {
    const audienceFilter = sp.audience === "all" || sp.audience === "creators" || sp.audience === "admins" ? sp.audience : "any";
    const statusFilter = sp.status === "published" || sp.status === "draft" ? sp.status : "any";
    const conditions = [
      audienceFilter !== "any" ? eq(S.announcements.target_audience, audienceFilter) : undefined,
      statusFilter === "published" ? eq(S.announcements.is_published, 1) : statusFilter === "draft" ? eq(S.announcements.is_published, 0) : undefined,
    ].filter((c) => c !== undefined);
    const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
    const rows = await refDb.select().from(S.announcements).where(where).orderBy(desc(S.announcements.created_at)).limit(50);
    return canon({
      audience: audienceFilter,
      status: statusFilter,
      items: rows.map((r) => pick(r, ["id", "title", "is_published", "publish_at", "expire_at", "updated_at"])),
    });
  }

  async function refRules(status) {
    const statusFilter = status === "published" || status === "draft" || status === "archived" ? status : "any";
    const [rows, currentPublishedRows] = await Promise.all([
      refDb.select().from(S.termsVersions).where(statusFilter === "any" ? undefined : eq(S.termsVersions.status, statusFilter)).orderBy(desc(S.termsVersions.updated_at)).limit(20),
      refDb.select().from(S.termsVersions).where(eq(S.termsVersions.status, "published")).orderBy(desc(S.termsVersions.published_at), desc(S.termsVersions.updated_at)).limit(1),
    ]);
    const currentPublished = currentPublishedRows[0] ?? null;
    let count = 0;
    let lower = false;
    const requiredMajor = await getLatestPublishedMajorTerms(refDb);
    const reacceptRows = requiredMajor
      ? await refDb.select({ id: S.users.id }).from(S.users).where(termsReacceptRequiredCondition(requiredMajor)).orderBy(S.users.id).limit(31)
      : [];
    lower = reacceptRows.length > 30;
    count = Math.min(reacceptRows.length, 30);
    return canon({
      status: statusFilter,
      items: rows.map((r) => pick(r, ["id", "version_label", "status", "severity", "published_at", "updated_at"])),
      currentPublished: currentPublished ? { id: currentPublished.id, version_label: currentPublished.version_label } : null,
      reacceptRequiredCount: count,
      reacceptCountIsLowerBound: lower,
    });
  }

  const AUDIT_OPERATIONS = ["CREATE", "UPDATE", "DELETE", "RESTORE", "STATUS_CHANGE", "MERGE", "SYSTEM"];
  const RESTORE_STATUSES = ["restorable", "restored", "expired", "not_restorable", "blocked", "failed"];
  async function refAudit(sp) {
    const parseDateBoundary = (s, end) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const t = Date.parse(`${s}${end ? "T23:59:59+09:00" : "T00:00:00+09:00"}`);
      return Number.isNaN(t) ? null : Math.floor(t / 1000);
    };
    const tableFilter = (sp.table ?? "").trim();
    const operationFilter = (sp.operation ?? "").trim().toUpperCase();
    const actorFilter = (sp.actor ?? sp.operator ?? "").trim();
    const recordFilter = (sp.record ?? "").trim();
    const restoreStatusFilter = (sp.restore_status ?? "").trim();
    const sinceUnix = (sp.since ?? "").trim() ? parseDateBoundary(sp.since.trim(), false) : null;
    const untilUnix = (sp.until ?? "").trim() ? parseDateBoundary(sp.until.trim(), true) : null;
    const limitRaw = Number(sp.limit ?? "");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 50;
    const conds = [];
    if (tableFilter) conds.push(eq(S.auditLogs.table_name, tableFilter));
    if (AUDIT_OPERATIONS.includes(operationFilter)) conds.push(eq(S.auditLogs.operation, operationFilter));
    if (actorFilter) conds.push(eq(S.auditLogs.actor_user_id, actorFilter));
    if (recordFilter) conds.push(eq(S.auditLogs.target_id, recordFilter));
    if (RESTORE_STATUSES.includes(restoreStatusFilter)) conds.push(eq(S.auditLogs.restore_status, restoreStatusFilter));
    if (sinceUnix != null) conds.push(gte(S.auditLogs.created_at, sinceUnix));
    if (untilUnix != null) conds.push(lte(S.auditLogs.created_at, untilUnix));
    const rows = await refDb.select().from(S.auditLogs).where(conds.length > 0 ? and(...conds) : undefined).orderBy(desc(S.auditLogs.created_at)).limit(limit);
    const actorIds = Array.from(new Set(rows.map((r) => r.actor_user_id).filter(Boolean)));
    let operators = [];
    if (actorIds.length > 0) {
      operators = await refDb
        .select({ id: S.users.id, name: S.users.name, active_x_user_id: S.users.active_x_user_id, x_name: S.xUsers.x_name })
        .from(S.users)
        .leftJoin(S.xUsers, sql`lower(${S.xUsers.id}) = lower(${S.users.active_x_user_id})`)
        .where(inArray(S.users.id, actorIds));
    }
    const listRows = rows.map(({ before_json, after_json, inverse_patch_json, ...row }) => ({
      ...row,
      payload: { before: before_json == null ? null : [...before_json].length, after: after_json == null ? null : [...after_json].length, inverse: inverse_patch_json == null ? null : [...inverse_patch_json].length },
    }));
    return canon({ limit, truncated: false, rows: listRows, operators });
  }

  async function refAuditDetail(auditId) {
    const row = (await refDb.select().from(S.auditLogs).where(eq(S.auditLogs.id, auditId)).limit(1))[0];
    if (!row) return null;
    const [prevRows, nextRows] = await Promise.all([
      refDb.select({ id: S.auditLogs.id, created_at: S.auditLogs.created_at }).from(S.auditLogs).where(and(eq(S.auditLogs.table_name, row.table_name), eq(S.auditLogs.target_id, row.target_id), or(lt(S.auditLogs.created_at, row.created_at), and(eq(S.auditLogs.created_at, row.created_at), lt(S.auditLogs.id, row.id))))).orderBy(desc(S.auditLogs.created_at), desc(S.auditLogs.id)).limit(1),
      refDb.select({ id: S.auditLogs.id, created_at: S.auditLogs.created_at }).from(S.auditLogs).where(and(eq(S.auditLogs.table_name, row.table_name), eq(S.auditLogs.target_id, row.target_id), or(gt(S.auditLogs.created_at, row.created_at), and(eq(S.auditLogs.created_at, row.created_at), gt(S.auditLogs.id, row.id))))).orderBy(asc(S.auditLogs.created_at), asc(S.auditLogs.id)).limit(1),
    ]);
    return canon({ row, prev: prevRows[0] ?? null, next: nextRows[0] ?? null });
  }

  async function refAuditRestore() {
    const runs = await refDb.select().from(S.auditRestoreRuns).orderBy(desc(S.auditRestoreRuns.executed_at)).limit(50);
    const auditIds = Array.from(new Set(runs.map((r) => r.audit_log_id)));
    const auditMap = new Map();
    if (auditIds.length > 0) {
      for (const row of await refDb.select().from(S.auditLogs).where(inArray(S.auditLogs.id, auditIds))) auditMap.set(row.id, row);
    }
    return canon({
      runs: runs.map((run) => {
        const log = auditMap.get(run.audit_log_id);
        return {
          id: run.id, audit_log_id: run.audit_log_id, status: run.status, executed_at: run.executed_at,
          executed_by_user_id: run.executed_by_user_id, reason: run.reason, error_message: run.error_message ?? null,
          log: log ? { table_name: log.table_name, target_id: log.target_id } : null,
        };
      }),
    });
  }

  async function refNotifications(sp) {
    const statusOf = (v) => (["pending", "processing", "sent", "failed", "cancelled"].includes(v) ? v : "all");
    const status = statusOf(sp.status);
    const typeFilter = (sp.type ?? "").trim();
    const eventFilter = (sp.event ?? "").trim();
    const qFilter = (sp.q ?? "").trim().slice(0, 100);
    const allowed = ADMIN_NOTIFICATION_CATEGORY_OPTIONS.map((o) => o.key);
    const catFilter = allowed.includes((sp.cat ?? "").trim()) ? (sp.cat ?? "").trim() : "all";
    const conditions = [];
    if (status === "failed") conditions.push(inArray(S.notificationOutbox.status, [...TERMINAL_NOTIFICATION_FAILURE_STATUSES]));
    else if (status !== "all") conditions.push(eq(S.notificationOutbox.status, status));
    if (typeFilter) conditions.push(eq(S.notificationOutbox.type, typeFilter));
    if (eventFilter) conditions.push(eq(S.notificationOutbox.event_id, eventFilter));
    if (qFilter) conditions.push(like(S.notificationOutbox.payload_json, `%${qFilter}%`));
    if (catFilter !== "all") conditions.push(drizzleNotificationCategoryCondition(catFilter, S.notificationOutbox.type));
    const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
    const now = Math.floor(Date.now() / 1000);
    const list = await refDb.select().from(S.notificationOutbox).where(where).orderBy(desc(S.notificationOutbox.created_at)).limit(100);
    const [operational] = await refDb
      .select({
        pending: sql`SUM(CASE WHEN ${S.notificationOutbox.status} = 'pending' THEN 1 ELSE 0 END)`,
        processing: sql`SUM(CASE WHEN ${S.notificationOutbox.status} = 'processing' THEN 1 ELSE 0 END)`,
        failed: sql`SUM(CASE WHEN ${S.notificationOutbox.status} = 'failed' THEN 1 ELSE 0 END)`,
        deadLetter: sql`SUM(CASE WHEN ${S.notificationOutbox.status} = 'dead_letter' THEN 1 ELSE 0 END)`,
      })
      .from(S.notificationOutbox)
      .where(inArray(S.notificationOutbox.status, ["pending", "processing", "failed", "dead_letter"]));
    const [unhealthy] = await refDb
      .select({ count: sql`COUNT(*)` })
      .from(S.notificationOutbox)
      .where(and(eq(S.notificationOutbox.status, "processing"), or(isNull(S.notificationOutbox.lease_expires_at), lte(S.notificationOutbox.lease_expires_at, now))));
    const recipients = await lookupNotificationRecipients(refDb, list.map((r) => r.recipient_user_id).filter((id) => id != null));
    return canon({
      status,
      category: catFilter,
      truncated: false,
      error: null,
      counts: {
        pending: Number(operational?.pending ?? 0),
        processing: Number(operational?.processing ?? 0),
        failed: Number(operational?.failed ?? 0),
        deadLetter: Number(operational?.deadLetter ?? 0),
        unhealthyLease: Number(unhealthy?.count ?? 0),
      },
      rows: list.map((r) => ({
        ...pick(r, ["id", "type", "status", "payload_json", "event_id", "recipient_user_id", "attempt_count", "next_attempt_at", "created_at", "last_error", "dedupe_key"]),
        recipient: r.recipient_user_id == null ? null : recipients.get(r.recipient_user_id) ?? null,
      })),
    });
  }

  async function refYoutubeSync(sp) {
    const first = (v) => (typeof v === "string" ? v.trim() : "");
    const syncStatus = first(sp.sync_status);
    const privacy = first(sp.privacy);
    const availability = first(sp.availability);
    const visibility = normalizeVideoVisibilityFilter(sp.visibility);
    const failedOnly = first(sp.failed) === "1";
    const staleOnly = first(sp.stale) === "1";
    const missingOnly = first(sp.missing) === "1";
    const now = Math.floor(Date.now() / 1000);
    const STALE = 14 * 24 * 60 * 60;
    const conds = [];
    if (syncStatus === "pending" || syncStatus === "synced" || syncStatus === "failed") conds.push(eq(S.videoYoutubeMetadata.sync_status, syncStatus));
    if (privacy) conds.push(eq(S.videoYoutubeMetadata.youtube_privacy_status, privacy));
    if (availability) conds.push(eq(S.videoYoutubeMetadata.youtube_availability_status, availability));
    const statuses = videoVisibilityStatusesForFilter(visibility);
    if (statuses && statuses.length > 1) conds.push(inArray(S.videos.visibility_status, statuses));
    else if (statuses?.[0]) conds.push(eq(S.videos.visibility_status, statuses[0]));
    if (failedOnly) conds.push(eq(S.videoYoutubeMetadata.sync_status, "failed"));
    if (staleOnly) conds.push(or(sql`${S.videoYoutubeMetadata.synced_at} IS NULL`, lt(S.videoYoutubeMetadata.synced_at, now - STALE)));
    if (missingOnly) conds.push(or(sql`${S.videos.youtube_video_id} IS NULL`, eq(S.videos.youtube_video_id, "")));
    const result = await refDb
      .select({
        video_id: S.videos.id, title: S.videos.title, creator_name: S.videos.creator_display_name, youtube_video_id: S.videos.youtube_video_id,
        visibility_status: S.videos.visibility_status, youtube_privacy_status: S.videoYoutubeMetadata.youtube_privacy_status,
        youtube_availability_status: S.videoYoutubeMetadata.youtube_availability_status, duration_seconds: S.videoYoutubeMetadata.duration_seconds,
        view_count: S.videoYoutubeMetadata.view_count, sync_status: S.videoYoutubeMetadata.sync_status, sync_error: S.videoYoutubeMetadata.sync_error,
        synced_at: S.videoYoutubeMetadata.synced_at, updated_at: S.videoYoutubeMetadata.updated_at,
      })
      .from(S.videos)
      .leftJoin(S.videoYoutubeMetadata, eq(S.videoYoutubeMetadata.video_id, S.videos.id))
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(sql`COALESCE(${S.videoYoutubeMetadata.updated_at}, ${S.videos.updated_at}, ${S.videos.created_at})`))
      .limit(101);
    return canon({
      filters: { sync_status: syncStatus, privacy, availability, visibility, failed: failedOnly, stale: staleOnly, missing: missingOnly },
      hasMore: result.length > 100,
      truncated: false,
      rows: result.slice(0, 100),
    });
  }

  const { readAdminSystemSettings } = await import("../../../src/lib/admin/adminSystemSettings.ts");
  const { resolveOperationMode } = await import("../../../src/lib/operationMode/resolve.ts");
  async function refCostGuard() {
    let mode = "normal";
    let isMaintenance = false;
    let reason = null;
    let updatedAt = null;
    let exceptionUntil = null;
    let exceptionFeaturesJson = null;
    let disabledFeaturesJson = null;
    const settings = await readAdminSystemSettings(refDb);
    if (settings) {
      mode = resolveOperationMode(settings);
      isMaintenance = mode === "maintenance";
      reason = settings.cost_guard_reason;
      updatedAt = settings.cost_guard_updated_at ?? null;
      exceptionUntil = settings.cost_guard_exception_until ?? null;
      exceptionFeaturesJson = settings.cost_guard_exception_features_json;
      disabledFeaturesJson = settings.disabled_features_json;
    }
    const history = await refDb
      .select()
      .from(S.auditLogs)
      .where(and(eq(S.auditLogs.table_name, "system_settings"), eq(S.auditLogs.operation, "UPDATE")))
      .orderBy(desc(S.auditLogs.created_at))
      .limit(20);
    return canon({
      mode, isMaintenance, reason, updatedAt, exceptionUntil, exceptionFeaturesJson, disabledFeaturesJson, truncated: false,
      history: history.map((h) => pick(h, ["id", "created_at", "actor_user_id", "target_id", "before_json", "after_json"])),
    });
  }

  const { fetchAdminTopSnapshot } = await import("../../../src/lib/admin/adminPendingCounts.ts");

  // Concatenates /audit/:id/payload/:field chunks; null when the column is SQL NULL (404).
  async function readPayload(id, field) {
    let offset = 0;
    let text = "";
    for (;;) {
      const r = await call(`/api/admin-read/audit/${id}/payload/${field}?offset=${offset}`, ADMIN);
      if (r.status === 404) return null;
      assert.equal(r.status, 200);
      assert.ok(r.text.length <= 64 * 1024, "chunk response <= 64 KiB");
      assert.equal(r.stats.statements, 2);
      assert.equal(r.stats.writes, 0);
      text += r.body.chunk;
      if (r.body.nextOffset == null) return text;
      offset = r.body.nextOffset;
    }
  }

  // ---------------- T03 authz ----------------
  const ENDPOINTS = [
    "/announcements", "/announcements/ann-01", "/rules", "/rules/T2",
    "/audit-settings", "/audit", "/audit/a1", "/audit/restore", "/ops/notifications", "/ops/youtube-sync", "/ops/cost-guard", "/ops/top", "/api-endpoints", "/ops/youtube-quota", "/ops/youtube-playlists", "/ops/workers", "/ops/static-builds", "/ops/health", "/permissions/simulator?event_id=ev1&x_user_id=sx",
  ];

  test("T03 guest (no cookie, expired, unknown token) -> 401, no-store, one D1 statement at most", async () => {
    for (const path of ENDPOINTS) {
      for (const token of [null, "tok-expired", "tok-nope"]) {
        const r = await call(`/api/admin-read${path}`, token);
        assert.equal(r.status, 401, `${path} ${token}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(r.body, { error: "Unauthorized" });
        assert.ok(r.stats.statements <= 1);
      }
    }
  });

  test("T03 non-admin (user, moderator) -> 403 and banned -> 403, before any page query", async () => {
    for (const path of ENDPOINTS) {
      for (const token of ["tok-alice", "tok-mod", "tok-banned"]) {
        const r = await call(`/api/admin-read${path}`, token);
        assert.equal(r.status, 403, `${path} ${token}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.equal(r.stats.statements, 1, "only the session lookup ran");
      }
    }
  });

  test("T03 only GET is routed (writes under /api/admin-read are 404)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await call("/api/admin-read/announcements", ADMIN, { method });
      assert.equal(r.status, 404, method);
      assert.equal(r.stats.writes, 0);
    }
  });

  test("T03 D1 failure -> 503 {error:unavailable}, no-store, no internals", async () => {
    for (const [path, match] of [
      ["/announcements", /FROM announcements/],
      ["/rules", /terms_versions/],
      ["/audit", /FROM audit_logs/],
      ["/audit/restore", /audit_restore_runs/],
      ["/audit-settings", /system_settings/],
      ["/ops/youtube-sync", /video_youtube_metadata/],
    ]) {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      d1.prepare = (text) => {
        if (match.test(text)) throw new Error("secret-internal tok-carol");
        return prepare(text);
      };
      const r = await call(`/api/admin-read${path}`, ADMIN, { d1 });
      assert.equal(r.status, 503, path);
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(r.body, { error: "unavailable" });
      assert.doesNotMatch(r.text, /secret-internal|tok-carol/);
    }
  });

  // ---------------- announcements ----------------
  test("T02 announcements list equals CURRENT for every filter (limit 50, newest created first)", async () => {
    for (const sp of [{}, { audience: "creators" }, { status: "published" }, { status: "draft", audience: "admins" }, { audience: "bogus", status: "bogus" }]) {
      const query = new URLSearchParams(sp).toString();
      const r = await get(`/announcements${query ? `?${query}` : ""}`);
      assert.deepEqual(r.body, await refAnnouncements(sp), JSON.stringify(sp));
    }
    assert.equal((await get("/announcements")).body.items.length, 50);
  });

  test("T02 announcement detail equals CURRENT; missing id -> 404", async () => {
    const r = await get("/announcements/ann-07");
    const row = (await refDb.select().from(S.announcements).where(eq(S.announcements.id, "ann-07")).limit(1))[0];
    assert.deepEqual(r.body, { item: canon(pick(row, ["id", "title", "body", "severity", "target_audience", "is_published", "publish_at", "expire_at", "updated_at"])) });
    const missing = await call("/api/admin-read/announcements/nope", ADMIN);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "private, no-store");
  });

  // ---------------- rules ----------------
  test("T02 rules list equals CURRENT for every status (limit 20, current published, reaccept count)", async () => {
    for (const status of [undefined, "published", "draft", "archived", "bogus"]) {
      const r = await get(`/rules${status ? `?status=${status}` : ""}`);
      assert.deepEqual(r.body, await refRules(status), String(status));
    }
    const base = (await get("/rules")).body;
    assert.equal(base.items.length, 20);
    assert.equal(base.currentPublished.id, "T2");
    assert.equal(base.reacceptRequiredCount, 1, "bob accepted an older major only");
    assert.equal(base.reacceptCountIsLowerBound, false);
  });

  test("T02 rules reaccept count stops at 30 and flags a lower bound (31 stale users)", async () => {
    for (let i = 0; i < 35; i += 1) {
      ins("user", { id: `u_stale${String(i).padStart(2, "0")}`, name: "s", email: `s${i}@example.test`, role: "user", is_tos_accepted: 1, accepted_terms_version_id: "T1", created_at: T0 });
    }
    const r = await get("/rules");
    assert.deepEqual(r.body, await refRules(undefined));
    assert.equal(r.body.reacceptRequiredCount, 30);
    assert.equal(r.body.reacceptCountIsLowerBound, true);
  });

  test("T05 rules: a failing reaccept count is swallowed like CURRENT's try/catch (200, count 0)", async () => {
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/required_major AS/.test(text) && !/UNION ALL/.test(text)) throw new Error("boom");
      return prepare(text);
    };
    const r = await call("/api/admin-read/rules", ADMIN, { d1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.reacceptRequiredCount, 0);
    assert.equal(r.body.reacceptCountIsLowerBound, false);
    assert.ok(r.body.items.length > 0);
  });

  test("T02 rule detail equals CURRENT; missing -> 404", async () => {
    const r = await get("/rules/T2");
    const row = (await refDb.select().from(S.termsVersions).where(eq(S.termsVersions.id, "T2")).limit(1))[0];
    assert.deepEqual(r.body, { item: canon(pick(row, ["id", "version_label", "body_markdown", "severity", "status"])) });
    assert.equal((await call("/api/admin-read/rules/nope", ADMIN)).status, 404);
  });

  // ---------------- audit settings ----------------
  test("T02 audit settings: defaults without a row, stored values with one (CURRENT getAuditLogSettings)", async () => {
    sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
    const noRow = (await get("/audit-settings")).body;
    assert.deepEqual(noRow, { settings: canon(await getAuditLogSettings(refDb)) });
    assert.deepEqual(noRow.settings, { normal_retention_days: 30, restorable_retention_days: 180, long_audit_retention_days: 365, max_payload_bytes: 120000, compact_after_days: 30 });
    ins("system_settings", { id: "default", audit_normal_retention_days: 11, audit_restorable_retention_days: 222, audit_long_retention_days: 333, audit_max_payload_bytes: 44444, audit_compact_after_days: 5 });
    const r = await get("/audit-settings");
    assert.deepEqual(r.body, { settings: canon(await getAuditLogSettings(refDb)) });
    assert.equal(r.body.settings.audit_max_payload_bytes, undefined);
    assert.equal(r.body.settings.max_payload_bytes, 44444);
  });

  // ---------------- audit ----------------
  test("T02 audit list equals CURRENT for every filter (JST day boundaries, legacy operator, limit clamp, actors)", async () => {
    for (const sp of [
      {}, { table: "videos" }, { operation: "update" }, { operation: "BOGUS" }, { actor: "u_carol" }, { operator: "u_alice" },
      { record: "v1" }, { restore_status: "restorable" }, { restore_status: "bogus" }, { limit: "3" }, { limit: "9999" }, { limit: "-4" },
      { since: "2023-11-15", until: "2023-11-15" }, { since: "2023-11-14", until: "2023-11-14" }, { since: "bogus" },
      { table: "videos", operation: "UPDATE", actor: "u_alice" },
    ]) {
      const query = new URLSearchParams(sp).toString();
      const r = await get(`/audit${query ? `?${query}` : ""}`);
      assert.deepEqual(r.body, await refAudit(sp), JSON.stringify(sp));
    }
    const base = (await get("/audit")).body;
    assert.equal(base.rows[0].id, "a8", "newest first");
    assert.ok(base.operators.some((o) => o.id === "u_alice"));
  });

  test("T05 audit list shows rows exactly as stored (no extra columns, redacted payloads stay redacted)", async () => {
    ins("audit_logs", { id: "a-red", table_name: "user", target_id: "u1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 999, before_json: JSON.stringify({ email: "[REDACTED]" }), after_json: JSON.stringify({ email: "[REDACTED]" }) });
    const r = await get("/audit?record=u1");
    assert.deepEqual(r.body, await refAudit({ record: "u1" }));
    assert.deepEqual(Object.keys(r.body.rows[0]).sort(), Object.keys((await refAudit({ record: "u1" })).rows[0]).sort());
    assert.equal(r.body.rows[0].after_json, undefined, "list rows never carry payload bodies");
    assert.equal(r.body.rows[0].payload.after, JSON.stringify({ email: "[REDACTED]" }).length);
    assert.match(await readPayload("a-red", "after"), /REDACTED/, "redacted body stays reachable via the chunk endpoint");
  });

  test("S2 budget: oversized payload rows return lengths only (no bodies) and stay under 64 KiB", async () => {
    const big = "あ".repeat(40_000);
    for (let i = 0; i < 100; i += 1) {
      ins("audit_logs", { id: `a-big${i}`, table_name: "big", target_id: "b1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 2000 + i, before_json: big, after_json: big, inverse_patch_json: big });
    }
    const r = await get("/audit?table=big&limit=100");
    assert.equal(r.status, 200);
    assert.ok(new TextEncoder().encode(r.text).length < 64 * 1024, "response < 64 KiB bytes");
    assert.equal(r.body.rows[0].id, "a-big99", "newest first");
    assert.equal(r.body.rows[0].payload.before, 40_000);
    assert.doesNotMatch(r.text, /あ/, "no payload body in the list");
    assert.doesNotMatch(r.text, /before_json|after_json|inverse_patch_json/);
    assert.equal((await readPayload("a-big99", "before")).length, 40_000, "full payload via chunk endpoint");
  });

  test("S2 budget: byte bound is enforced (UTF-8) including the first row; truncated is reported", async () => {
    const wide = "あ".repeat(20_000); // 60,000 UTF-8 bytes in 20,000 UTF-16 units
    for (let i = 0; i < 3; i += 1) {
      ins("audit_logs", { id: `a-wide${i}`, table_name: "wide", target_id: "w1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 3000 + i, reason: wide });
    }
    const first = await get("/audit?table=wide");
    assert.equal(first.body.truncated, true);
    assert.deepEqual(first.body.rows, [], "a first row over the byte budget is not returned either");
    assert.ok(new TextEncoder().encode(first.text).length < 64 * 1024);
    const mid = "あ".repeat(4_000); // 12,000 bytes per row
    for (let i = 0; i < 6; i += 1) {
      ins("audit_logs", { id: `a-mid${i}`, table_name: "mid", target_id: "m1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 4000 + i, reason: mid });
    }
    const r = await get("/audit?table=mid");
    assert.equal(r.body.truncated, true);
    assert.equal(r.body.rows.length, 3);
    assert.equal(r.body.rows[0].id, "a-mid5");
    assert.ok(new TextEncoder().encode(r.text).length < 64 * 1024);
  });

  test("T02 audit detail equals CURRENT (prev/next on the same target); missing -> 404", async () => {
    for (const id of ["a1", "a2", "a5", "a3", "a7"]) {
      const r = (await get(`/audit/${id}`)).body;
      const ref = await refAuditDetail(id);
      const { before_json, after_json, inverse_patch_json, ...refRow } = ref.row;
      assert.deepEqual({ row: r.row, prev: r.prev, next: r.next }, { row: refRow, prev: ref.prev, next: ref.next }, id);
      // payloads come back through the chunk endpoint and reassemble to CURRENT's stored text
      for (const [field, expected] of [["before", before_json], ["after", after_json], ["inverse", inverse_patch_json]]) {
        assert.equal(r.payload[field], expected == null ? null : expected.length, `${id} ${field} length`);
        assert.equal(await readPayload(id, field), expected, `${id} ${field}`);
      }
    }
    const a2 = (await get("/audit/a2")).body;
    assert.equal(a2.prev.id, "a1");
    assert.equal(a2.next.id, "a5");
    assert.equal((await call("/api/admin-read/audit/nope", ADMIN)).status, 404);
  });

  test("T02 audit neighbors exclude another table reusing the same target_id", async () => {
    // The unrelated row is nearer to a2 than the actual videos/a5 neighbor.
    ins("audit_logs", { id: "a-cross-table", table_name: "announcements", target_id: "v1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 25 });
    try {
      const r = (await get("/audit/a2")).body;
      assert.equal(r.prev.id, "a1");
      assert.equal(r.next.id, "a5");
      const ref = await refAuditDetail("a2");
      assert.deepEqual({ prev: r.prev, next: r.next }, { prev: ref.prev, next: ref.next });
      const unrelated = (await get("/audit/a-cross-table")).body;
      assert.equal(unrelated.prev, null);
      assert.equal(unrelated.next, null);
    } finally {
      sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run("a-cross-table");
    }
  });

  test("T02 audit neighbors are deterministic for same-second rows and remain table-scoped", async () => {
    // Audit timestamps are seconds: strict < / > alone skipped simultaneous writes.
    ins("audit_logs", { id: "a1z", table_name: "videos", target_id: "v1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 20 });
    ins("audit_logs", { id: "a1y", table_name: "announcements", target_id: "v1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 20 });
    try {
      for (const [id, prev, next] of [
        ["a1", null, "a1z"],
        ["a1z", "a1", "a2"],
        ["a2", "a1z", "a5"],
        ["a5", "a2", null],
      ]) {
        const result = (await get(`/audit/${id}`)).body;
        assert.equal(result.prev?.id ?? null, prev, `${id}: previous`);
        assert.equal(result.next?.id ?? null, next, `${id}: next`);
        const reference = await refAuditDetail(id);
        assert.deepEqual({ prev: result.prev, next: result.next }, { prev: reference.prev, next: reference.next });
      }
      const differentTable = (await get("/audit/a1y")).body;
      assert.equal(differentTable.prev, null);
      assert.equal(differentTable.next, null);
    } finally {
      sqlite.prepare("DELETE FROM audit_logs WHERE id IN (?, ?)").run("a1z", "a1y");
    }
  });

  test("S2 budget: a 120 KB / non-ASCII payload never 503s or exceeds 64 KiB; chunks reassemble exactly", async () => {
    const big = JSON.stringify({ text: "あ𠮷x".repeat(40_000) });
    ins("audit_logs", { id: "a-huge", table_name: "huge", target_id: "h1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 9000, before_json: big, after_json: big + "z", inverse_patch_json: "{}" });
    const detail = await get("/audit/a-huge");
    assert.equal(detail.body.payload.before, [...big].length, "length() counts characters");
    assert.equal(await readPayload("a-huge", "before"), big);
    assert.equal(await readPayload("a-huge", "after"), big + "z");
    assert.equal(await readPayload("a-huge", "inverse"), "{}");
    const row = (await refAuditDetail("a-huge")).row;
    assert.equal(row.before_json, big);
    assert.equal((await call("/api/admin-read/audit/a-huge/payload/bogus", ADMIN)).status, 404);
    assert.equal((await call("/api/admin-read/audit/nope/payload/before", ADMIN)).status, 404);
    assert.equal((await call("/api/admin-read/audit/a-huge/payload/before", "tok-alice")).status, 403);
  });

  test("T02 audit restore history equals CURRENT (newest first, join to audit target, missing log -> null)", async () => {
    const r = await get("/audit/restore");
    assert.deepEqual(r.body, await refAuditRestore());
    assert.deepEqual(r.body.runs.map((x) => x.id), ["rr2", "rr3", "rr1"]);
    assert.equal(r.body.runs[0].log, null);
  });

  // ---------------- ops ----------------
  test("T02 notifications equals CURRENT for every filter (rows, recipients, counts, unhealthy leases)", async () => {
    for (const sp of [
      {}, { status: "pending" }, { status: "processing" }, { status: "failed" }, { status: "sent" }, { status: "cancelled" }, { status: "bogus" },
      { type: "video_approved" }, { event: "ev1" }, { q: "findme" }, { cat: "video" }, { cat: "slot" }, { cat: "x_id" }, { cat: "system" },
      { cat: "unknown" }, { cat: "event" }, { cat: "chapter" }, { cat: "announcement" }, { cat: "moderation" }, { cat: "bogus" },
      { status: "failed", cat: "system", event: "ev1" },
    ]) {
      const query = new URLSearchParams(sp).toString();
      const r = await get(`/ops/notifications${query ? `?${query}` : ""}`);
      assert.deepEqual(r.body, await refNotifications(sp), JSON.stringify(sp));
    }
    const base = (await get("/ops/notifications")).body;
    assert.equal(base.rows.length, 100);
    assert.deepEqual(base.counts, { pending: 2, processing: 3, failed: 1, deadLetter: 1, unhealthyLease: 2 });
  });

  test("T05 notifications: a failing list/count query degrades like CURRENT (200, empty rows, fixed error code)", async () => {
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/FROM notification_outbox n/.test(text)) throw new Error("secret-internal");
      return prepare(text);
    };
    const r = await call("/api/admin-read/ops/notifications", ADMIN, { d1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.error, "query_failed");
    assert.deepEqual(r.body.rows, []);
    assert.doesNotMatch(r.text, /secret-internal/);
  });

  test("T02 admin top counts equal CURRENT fetchAdminTopSnapshot (one statement); failure -> empty counts (200)", async () => {
    ins("events", { id: "ev-open", title: "Open", visibility_status: "public", entry_start_time: nowS - 100, entry_end_time: nowS + 1000 });
    ins("events", { id: "ev-closed", title: "Closed", visibility_status: "public", entry_start_time: nowS - 100, entry_end_time: nowS - 10 });
    ins("slots", { id: "so1", event_id: "ev-open", status: "reserved", sort_order: 0 });
    ins("slots", { id: "so2", event_id: "ev-open", status: "reserved", sort_order: 1 });
    ins("slots", { id: "so3", event_id: "ev-closed", status: "reserved", sort_order: 0 });
    ins("video_moderation_cases", { id: "mc1", video_id: "va1", case_type: "void", status: "open", due_at: nowS - 5, created_at: T0 });
    ins("video_moderation_cases", { id: "mc2", video_id: "va2", case_type: "void", status: "open", due_at: nowS + 500, created_at: T0 });
    ins("video_moderation_cases", { id: "mc3", video_id: "va3", case_type: "void", status: "open", due_at: null, created_at: T0 });
    sqlite.exec("UPDATE notification_outbox SET processing_started_at = " + (nowS - 3600) + " WHERE id = 'n2'");
    sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
    ins("system_settings", { id: "default", operation_mode: "maintenance" });
    const r = await get("/ops/top");
    const ref = await fetchAdminTopSnapshot(refDb);
    assert.deepEqual(r.body, canon(ref));
    assert.equal(r.stats.statements, 2);
    assert.ok(r.body.counts.reservedOpenSlots === 2 && r.body.counts.moderationOpen === 3 && r.body.counts.moderationOverdue === 1);
    assert.ok(r.body.counts.notificationStuck >= 1 && r.body.counts.xLinkRequests >= 1);
    assert.equal(r.body.isMaintenance, 1);
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/pending_videos/.test(text)) throw new Error("secret-internal");
      return prepare(text);
    };
    const failed = await call("/api/admin-read/ops/top", ADMIN, { d1 });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.counts.pendingVideos, 0);
    assert.equal(failed.body.mode, "normal");
    sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
    ins("system_settings", { id: "default" });
  });

  test("T02 api-endpoints equals CURRENT page queries (enabled events, public events, limit 100)", async () => {
    for (let i = 0; i < 3; i += 1) {
      ins("events", { id: `api-${i}`, title: `Api ${i}`, visibility_status: i === 2 ? "private" : "public", public_api_enabled: i === 0 ? 0 : 1, created_at: T0 + 7000 + i, updated_at: T0 + 8000 + i });
    }
    const enabledRows = await refDb
      .select({ id: S.events.id, event_id: S.events.id, public_api_enabled: S.events.public_api_enabled, updated_at: S.events.updated_at, created_at: S.events.created_at, event_title: S.events.title, event_visibility_status: S.events.visibility_status })
      .from(S.events).where(eq(S.events.public_api_enabled, 1)).orderBy(desc(S.events.updated_at), desc(S.events.created_at)).limit(100);
    const publicEvents = await refDb
      .select({ id: S.events.id, title: S.events.title, enabled: S.events.public_api_enabled })
      .from(S.events).where(eq(S.events.visibility_status, "public")).orderBy(desc(S.events.created_at)).limit(100);
    const r = await get("/api-endpoints");
    assert.deepEqual(r.body, canon({ rows: enabledRows, eventOptions: publicEvents }));
    assert.deepEqual(r.body.rows.map((x) => x.id), ["api-2", "api-1"]);
  });

  test("T02 youtube quota equals CURRENT page maths (env fallback, stored row, bad env, query failure)", async () => {
    const policy = await import("../../../src/lib/youtube/quotaPolicy.ts");
    const refQuota = async (raw) => {
      const now = Math.floor(Date.now() / 1000);
      const quotaDay = policy.youtubeQuotaDay(new Date(now * 1_000));
      const configuredFallback = policy.resolveYoutubeDailyQuotaUnits(raw);
      const budgetFallback = policy.youtubeDailyBudgetUnits(raw);
      const row = sqlite.prepare("SELECT used_units, limit_units, updated_at FROM external_api_quota_usage WHERE provider = ?1 AND quota_day = ?2 LIMIT 1").get(policy.YOUTUBE_PROVIDER_KEY, quotaDay) ?? null;
      const rowBudget = Number(row?.limit_units ?? 0);
      const budgetUnits = rowBudget > 0 ? rowBudget : budgetFallback;
      const configuredUnits = rowBudget > 0 ? Math.ceil((rowBudget * 100) / policy.YOUTUBE_TARGET_USAGE_PERCENT) : configuredFallback;
      const usedUnits = Math.max(0, Number(row?.used_units ?? 0));
      return canon({
        quotaDay, configuredUnits, budgetUnits, usedUnits, remainingUnits: Math.max(0, budgetUnits - usedUnits),
        usagePercent: budgetUnits > 0 ? Math.min(100, Math.round((usedUnits / budgetUnits) * 1_000) / 10) : 0,
        updatedAt: row?.updated_at ?? null, error: null,
      });
    };
    const fetchQuota = async (env) => {
      const r = await call("/api/admin-read/ops/youtube-quota", ADMIN, { env });
      assert.equal(r.status, 200);
      assert.equal(r.stats.statements, 2);
      return r.body;
    };
    for (const raw of [undefined, "20000", "50", "abc", "10000001", "20000oops", "20000.5", "2e4", "20000\n1", "00020000", "999999999999999999999999999999999"]) {
      assert.deepEqual(await fetchQuota({ YOUTUBE_DAILY_QUOTA_LIMIT: raw }), await refQuota(raw), String(raw));
    }
    // The admin read-only summary must not report an inflated budget for malformed settings.
    for (const raw of ["20000oops", "20000.5", "2e4"]) {
      const data = await fetchQuota({ YOUTUBE_DAILY_QUOTA_LIMIT: raw });
      assert.equal(data.configuredUnits, 10_000, raw);
      assert.equal(data.budgetUnits, 8_000, raw);
    }
    const day = policy.youtubeQuotaDay(new Date());
    ins("external_api_quota_usage", { provider: "youtube", quota_day: day, used_units: 1234, limit_units: 8000, updated_at: T0 });
    assert.deepEqual(await fetchQuota({ YOUTUBE_DAILY_QUOTA_LIMIT: "20000" }), await refQuota("20000"));
    assert.equal((await fetchQuota({})).usedUnits, 1234);
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/external_api_quota_usage/.test(text)) throw new Error("secret-internal");
      return prepare(text);
    };
    const failed = await call("/api/admin-read/ops/youtube-quota", ADMIN, { d1 });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.error, "query_failed");
    assert.equal(failed.body.usedUnits, 0);
    assert.doesNotMatch(failed.text, /secret-internal/);
  });

  test("T02 youtube playlists equals CURRENT page (filters, order, per-event counts, derived health sort)", async () => {
    const { derivePlaylistSyncHealth } = await import("../../../src/lib/youtube/playlistSyncHealth.ts");
    const sync = (event, o) =>
      ins("event_youtube_playlist_sync", { event_id: event, playlist_id: `PL${event}`, enabled: o.enabled ?? 1, sync_mode: "append", sync_interval_minutes: o.interval ?? 1440, sync_status: o.status, next_sync_at: o.next === undefined ? nowS + 3600 : o.next, last_synced_at: o.synced === undefined ? nowS - 60 : o.synced, last_full_scan_at: o.scan === undefined ? nowS - 60 : o.scan, last_error: o.error ?? null });
    sync("ev1", { status: "synced" });
    sync("ev2", { status: "failed", error: "quota" });
    sync("ev3", { status: "deferred", next: nowS + 10 });
    sync("ev4", { status: "scanning", next: null });
    sync("ev5", { status: "idle", enabled: 0 });
    sync("api-0", { status: "synced", next: nowS - 9 * 3600 });
    sync("api-1", { status: "idle", synced: null });
    sync("api-2", { status: "weird" });
    for (const v of ["va2", "va3", "va4", "va5"]) sqlite.exec("INSERT OR IGNORE INTO video_events (video_id, event_id) VALUES ('" + v + "', 'ev1')");
    sqlite.exec("INSERT OR IGNORE INTO video_events (video_id, event_id) VALUES ('va6', 'ev3')");
    ins("event_youtube_playlist_items", { event_id: "ev1", playlist_item_id: "pi1", youtube_video_id: "ytva2", seen_at: T0 });
    ins("event_youtube_playlist_items", { event_id: "ev1", playlist_item_id: "pi2", youtube_video_id: "ytva3", seen_at: T0 });

    const refPlaylists = async (sp) => {
      const first = (v) => (typeof v === "string" ? v.trim() : "");
      const enabledFilter = first(sp.enabled);
      const statusFilter = first(sp.status);
      const conds = [];
      if (enabledFilter === "1" || enabledFilter === "0") conds.push(eq(S.eventYoutubePlaylistSync.enabled, Number(enabledFilter)));
      if (["disabled", "idle", "scanning", "synced", "deferred", "failed"].includes(statusFilter)) conds.push(eq(S.eventYoutubePlaylistSync.sync_status, statusFilter));
      const configResult = await refDb
        .select({ event_id: S.eventYoutubePlaylistSync.event_id, event_title: S.events.title, playlist_id: S.eventYoutubePlaylistSync.playlist_id, enabled: S.eventYoutubePlaylistSync.enabled, sync_mode: S.eventYoutubePlaylistSync.sync_mode, sync_interval_minutes: S.eventYoutubePlaylistSync.sync_interval_minutes, sync_status: S.eventYoutubePlaylistSync.sync_status, next_sync_at: S.eventYoutubePlaylistSync.next_sync_at, last_synced_at: S.eventYoutubePlaylistSync.last_synced_at, last_full_scan_at: S.eventYoutubePlaylistSync.last_full_scan_at, last_error: S.eventYoutubePlaylistSync.last_error })
        .from(S.eventYoutubePlaylistSync)
        .innerJoin(S.events, eq(S.events.id, S.eventYoutubePlaylistSync.event_id))
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(sql`CASE ${S.eventYoutubePlaylistSync.sync_status} WHEN 'failed' THEN 4 WHEN 'deferred' THEN 3 WHEN 'scanning' THEN 2 ELSE 1 END`), asc(S.eventYoutubePlaylistSync.next_sync_at), asc(S.events.title))
        .limit(101);
      const visible = configResult.slice(0, 100);
      const now = Math.floor(Date.now() / 1000);
      const agg = visible.length === 0 ? [] : await refDb
        .select({
          event_id: S.videoEvents.event_id,
          linked_count: sql`COUNT(DISTINCT CASE WHEN ${S.videos.id} IS NOT NULL AND ${S.videos.visibility_status} <> 'voided' THEN ${S.videos.id} END)`,
          eligible_count: sql`COUNT(DISTINCT CASE WHEN ${S.videos.visibility_status} = 'public' AND ${S.videos.youtube_video_id} IS NOT NULL AND ${S.videos.youtube_video_id} <> '' THEN ${S.videos.id} END)`,
          synced_count: sql`COUNT(DISTINCT CASE WHEN ${S.eventYoutubePlaylistItems.playlist_item_id} IS NOT NULL AND ${S.videos.visibility_status} = 'public' THEN ${S.videos.id} END)`,
        })
        .from(S.videoEvents)
        .leftJoin(S.videos, eq(S.videos.id, S.videoEvents.video_id))
        .leftJoin(S.eventYoutubePlaylistItems, and(eq(S.eventYoutubePlaylistItems.event_id, S.videoEvents.event_id), eq(S.eventYoutubePlaylistItems.youtube_video_id, S.videos.youtube_video_id)))
        .where(inArray(S.videoEvents.event_id, visible.map((r) => r.event_id)))
        .groupBy(S.videoEvents.event_id);
      const counts = new Map(agg.map((r) => [r.event_id, { linked_count: Number(r.linked_count ?? 0), eligible_count: Number(r.eligible_count ?? 0), synced_count: Number(r.synced_count ?? 0) }]));
      const rows = visible
        .map((row, originalIndex) => {
          const full = { ...row, ...(counts.get(row.event_id) ?? { linked_count: 0, eligible_count: 0, synced_count: 0 }) };
          return { row: full, originalIndex, health: derivePlaylistSyncHealth({ enabled: full.enabled, syncStatus: full.sync_status, nextSyncAt: full.next_sync_at, lastSyncedAt: full.last_synced_at, lastFullScanAt: full.last_full_scan_at, lastError: full.last_error, eligibleCount: full.eligible_count, syncedCount: full.synced_count, linkedCount: full.linked_count, now }) };
        })
        .sort((l, r) => l.health.priority - r.health.priority || l.originalIndex - r.originalIndex)
        .map(({ row, health }) => ({ ...row, health }));
      return canon({ filters: { enabled: enabledFilter, status: statusFilter }, hasMore: configResult.length > 100, rows });
    };
    for (const sp of [{}, { enabled: "1" }, { enabled: "0" }, { status: "failed" }, { status: "synced" }, { status: "bogus" }, { enabled: "1", status: "idle" }]) {
      const query = new URLSearchParams(sp).toString();
      const r = await get(`/ops/youtube-playlists${query ? `?${query}` : ""}`);
      assert.deepEqual(r.body, await refPlaylists(sp), JSON.stringify(sp));
    }
    const base = (await get("/ops/youtube-playlists")).body;
    assert.equal(base.rows[0].health.level, "critical");
    assert.ok(base.rows.some((x) => x.health.reason === "overdue") && base.rows.some((x) => x.health.reason === "unknown_status"));
    const ev1 = base.rows.find((x) => x.event_id === "ev1");
    assert.deepEqual([ev1.linked_count, ev1.eligible_count, ev1.synced_count], [4, 4, 2]);

    // local health copy == real module on a grid of inputs
    const { derivePlaylistSyncHealth: local } = await import("../src/routes/adminRead/playlistHealth.ts");
    const nows = 1_700_000_000;
    for (const enabled of [0, 1, true, false]) for (const syncStatus of [null, "", "idle", "synced", "failed", "deferred", "scanning", "x"]) for (const next of [null, nows - 8000, nows + 5]) for (const last of [null, nows]) for (const scan of [null, nows]) for (const error of [null, " ", "e"]) for (const [eligible, synced, linked] of [[1, 1, 1], [2, 1, 3], [3, 3, 2], [-1, 0, 0], [Number.NaN, 0, 0]]) {
      const input = { enabled, syncStatus, nextSyncAt: next, lastSyncedAt: last, lastFullScanAt: scan, lastError: error, eligibleCount: eligible, syncedCount: synced, linkedCount: linked, now: nows };
      assert.deepEqual(local(input), derivePlaylistSyncHealth(input));
    }
  });

  test("T02 permission simulator equals CURRENT simulateEventPermissions (every preset, custom, alias, missing)", async () => {
    const { simulateEventPermissions } = await import("../../../src/lib/admin/permissionSimulator.ts");
    const presets = ["owner", "manager", "reviewer", "slot_manager", "content_editor", "xid_reviewer", "public_staff", "custom"];
    presets.forEach((preset, i) => {
      ins("event_staff", { id: `st-${preset}`, event_id: "ev1", x_user_id: `sx_${preset}`, display_name: `Staff ${preset}`, permission_preset: preset, custom_permission_keys_json: preset === "custom" ? JSON.stringify(["event.basic", "video.status", "xid.link_requests", 7, "bogus.key"]) : null, created_at: T0 + i, updated_at: T0 + i });
    });
    ins("event_staff", { id: "st-badjson", event_id: "ev1", x_user_id: "sx_badjson", display_name: "Bad", permission_preset: "custom", custom_permission_keys_json: "{not json", created_at: T0, updated_at: T0 });
    ins("event_staff", { id: "st-unknown", event_id: "ev1", x_user_id: "sx_unknown", display_name: "Unknown", permission_preset: "legacy_role", created_at: T0, updated_at: T0 });
    for (const [eventId, xUserId] of [
      ...presets.map((p) => ["ev1", `sx_${p}`]), ["ev1", "sx_badjson"], ["ev1", "sx_unknown"], ["ev1", "@sx_owner"], ["ev1", "  sx_manager  "],
      ["ev1", "nobody"], ["ev2", "sx_owner"], ["ev1", "@"], ["", "sx_owner"], ["ev1", ""],
    ]) {
      const query = new URLSearchParams({ event_id: eventId, x_user_id: xUserId }).toString();
      const r = await get(`/permissions/simulator?${query}`);
      const trimmedEvent = eventId.trim();
      const trimmedX = xUserId.trim();
      const expected = trimmedEvent && trimmedX ? canon(await simulateEventPermissions(refDb, { eventId: trimmedEvent, xUserId: trimmedX })) : null;
      assert.deepEqual(r.body, { eventId: trimmedEvent, xUserId: trimmedX, result: expected }, `${eventId}/${xUserId}`);
    }
    assert.equal((await get("/permissions/simulator?event_id=ev1&x_user_id=sx_owner")).body.result.found, true);
    assert.equal((await get("/permissions/simulator")).stats.statements, 1);
  });

  test("T02 security checks equal CURRENT runSecurityChecks (only with run=1; 7 queries -> 2 statements)", async () => {
    const { runSecurityChecks } = await import("../../../src/lib/admin/securityChecks.ts");
    ins("account", { userId: "u_alice", type: "oauth", provider: "twitter", providerAccountId: "p1", access_token: "super-secret-token-value" });
    ins("account", { userId: "u_bob", type: "oauth", provider: "twitter", providerAccountId: "p2" });
    ins("videos", { id: "v-ban", title: "B", submitted_by_user_id: "u_banned", creator_display_name: "n", creator_x_user_id: "dave_r", youtube_video_id: "ytban", visibility_status: "public", created_at: T0 });
    ins("videos", { id: "v-tos", title: "T", submitted_by_user_id: "u_carol", creator_display_name: "n", creator_x_user_id: "alice_x", youtube_video_id: "yttos", visibility_status: "public", created_at: T0 });
    ins("video_chapters", { id: "ch-ban", video_id: "v-ban", x_user_id: "banned_x", chapter_time: 1, chapter_label: "c", visibility: "public", created_at: T0, updated_at: T0 });
    ins("x_users", { id: "banned_x", x_name: "bx", approval_status: "approved" });
    ins("x_users", { id: "orphan_x", x_name: "ox", approval_status: "approved" });
    ins("x_user_account_links", { x_user_id: "banned_x", auth_user_id: "u_banned", created_at: T0 });

    const strip = (list) => list.map(({ note, ...r }) => ({ ...r, ...(note ? { note } : {}) }));
    const ref = canon(strip(await runSecurityChecks(refDb)));
    const r = await get("/ops/security?run=1");
    assert.deepEqual(r.body, { status: "all", ran: true, results: ref, error: null });
    assert.equal(r.stats.statements, 3, "session + 2 statements instead of 7 queries");
    assert.doesNotMatch(r.text, /super-secret-token-value/, "tokens are counted, never returned");
    assert.ok(ref.find((x) => x.id === "access_token_not_null").count === 1);
    assert.ok(ref.find((x) => x.id === "banned_user_chapters").count === 1);

    const idle = await get("/ops/security?status=warn");
    assert.deepEqual(idle.body, { status: "warn", ran: false, results: [], error: null });
    assert.equal(idle.stats.statements, 1, "no run -> no query");

    // Next receives repeated searchParams as arrays, not scalar opt-ins.
    for (const [query, expectedStatus, expectedRun] of [
      ["", "all", false],
      ["run=1&run=1", "all", false],
      ["run=1&run=0", "all", false],
      ["run=0&run=1", "all", false],
      ["run=1&run=", "all", false],
      ["run=&run=1", "all", false],
      ["run=1&%72un=1", "all", false],
      ["run=01", "all", false],
      ["run=true", "all", false],
      ["run=", "all", false],
      ["status=warn&status=warn", "all", false],
      ["status=warn&status=ok", "all", false],
      ["status=ok&status=warn&run=1", "all", true],
      ["status=info&run=1&run=0", "info", false],
      ["status=warn&run=1", "warn", true],
      ["status=info&run=1", "info", true],
      ["status=ok&run=1", "ok", true],
      ["status=bad&run=1", "all", true],
      ["status=&run=1", "all", true],
      ["run=%31&status=%77arn", "warn", true],
    ]) {
      const receipt = await call("/api/admin-read/ops/security" + (query ? "?" + query : ""), ADMIN);
      assert.equal(receipt.status, 200, query);
      assert.deepEqual(receipt.body, {
        status: expectedStatus,
        ran: expectedRun,
        results: expectedRun ? ref : [],
        error: null,
      }, query);
      assert.equal(receipt.headers.get("cache-control"), "private, no-store", query);
      assert.equal(receipt.stats.statements, expectedRun ? 3 : 1, query);
      assert.equal(receipt.stats.writes, 0, query);
      assert.doesNotMatch(receipt.text, /super-secret-token-value/, query);
    }

    // a failing group degrades to CURRENT's per-check failure result (warn, count 1) for its checks only
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/banned_user_videos/.test(text)) throw new Error("secret-internal");
      return prepare(text);
    };
    const failed = await call("/api/admin-read/ops/security?run=1", ADMIN, { d1 });
    assert.equal(failed.status, 200);
    const byId = Object.fromEntries(failed.body.results.map((x) => [x.id, x]));
    assert.equal(byId.banned_user_videos.status, "warn");
    assert.equal(byId.banned_user_videos.count, 1);
    assert.match(byId.banned_user_videos.note, /検査自体の実行に失敗/);
    assert.equal(byId.access_token_not_null.count, 1);
    assert.doesNotMatch(failed.text, /secret-internal/);
  });

  test("T02 workers monitoring equals CURRENT loadWorkerMonitoring (7 D1 statements -> 2, KV failures)", async () => {
    const { loadWorkerMonitoring } = await import("../../../src/lib/admin/workerMonitoring.ts");
    const lease = (job, o) => ins("worker_leases", { job_name: job, lease_token: o.token ?? "", lease_expires_at: o.expires ?? 0, last_started_at: o.started ?? null, last_succeeded_at: o.ok ?? null, last_failed_at: o.failed ?? null, last_error_code: o.code ?? null });
    lease("fast-jobs", { ok: nowS - 100, started: nowS - 110 });
    lease("content-jobs", { ok: nowS - 20000 });
    lease("sync-jobs", { ok: nowS - 8000, failed: nowS - 50, code: "quota" });
    lease("fast-jobs:slot-deadline-reminders", { token: "tok", expires: nowS + 600, started: nowS - 5 });
    ins("static_rebuild_queue", { id: "q1", target_type: "top", target_id: "global", status: "pending", created_at: nowS - 400 });
    ins("static_rebuild_queue", { id: "q2", target_type: "top", target_id: "x", status: "processing", lease_expires_at: nowS - 10, created_at: nowS - 300 });
    ins("static_rebuild_queue", { id: "q3", target_type: "top", target_id: "y", status: "dead_letter", created_at: nowS - 200 });
    ins("static_rebuild_queue", { id: "q4", target_type: "top", target_id: "z", status: "done", created_at: nowS - 200 });
    for (const [i, type] of ["top", "list_recent", "search_index"].entries()) {
      ins("static_artifacts", { id: `art${i}`, target_type: type, target_id: "global", object_key: `k${i}`, content_hash: "h", schema_version: 1, generated_at: T0 + i });
    }
    ins("static_artifacts", { id: "art-old", target_type: "top", target_id: "global", object_key: "k-old", content_hash: "h", schema_version: 1, generated_at: T0 - 5 });
    ins("static_artifacts", { id: "art-del", target_type: "events_index", target_id: "global", object_key: "k-del", content_hash: "h", schema_version: 1, generated_at: T0, deleted_at: T0 });
    sqlite.exec("UPDATE videos SET score_updated_at = " + nowS + " WHERE id IN ('va1','va2')");

    const kvStore = { "queue_wake:last_failure:notification_available": { at: nowS - 5, reason: "  queue down " }, "queue_wake:last_failure:youtube_sync_pending": { at: "bad", reason: "x" } };
    const fakeKv = { async get(key) { return kvStore[key] ?? null; } };
    const run = async (kv) => {
      const d1 = createD1(sqlite);
      const response = await app.request("/api/admin-read/ops/workers", { headers: cookie(ADMIN) }, { DB: d1, KV: kv });
      return { body: await response.json(), stats: d1.stats, status: response.status };
    };
    for (const kv of [fakeKv, undefined, { async get() { throw new Error("kv down"); } }]) {
      const r = await run(kv);
      assert.equal(r.status, 200);
      assert.equal(r.stats.statements, 3, "session + 2 statements");
      assert.equal(r.stats.writes, 0);
      assert.equal(r.body.error, null);
      const ref = await loadWorkerMonitoring(createD1(sqlite), { now: r.body.snapshot.generatedAt, kv });
      assert.deepEqual(r.body.snapshot, canon(ref));
    }
    const snap = (await run(fakeKv)).body.snapshot;
    assert.equal(snap.queueWakeFailures.notification_available.reason, "queue down");
    assert.equal(snap.queueWakeFailures.youtube_sync_pending, null);
    assert.equal(snap.overallLevel, "critical");
    assert.deepEqual(snap.artifacts.map((a) => a.targetType), ["list_recent", "search_index", "top"]);

    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/FROM worker_leases/.test(text)) throw new Error("secret-internal");
      return prepare(text);
    };
    const failed = await call("/api/admin-read/ops/workers", ADMIN, { d1 });
    assert.equal(failed.status, 200);
    assert.deepEqual(failed.body, { snapshot: null, error: "query_failed" });
    assert.doesNotMatch(failed.text, /secret-internal/);
  });

  test("T02 static builds equals CURRENT page loader (rows, counts, backfill summary, KV state, R2 head); diagnostics body reads are not made", async () => {
    const core = await import("../../../src/lib/staticRebuild/backfillStateCore.ts");
    const { like } = await import("drizzle-orm");
    const q = (id, status, o = {}) => ins("static_rebuild_queue", { id, target_type: o.type ?? "video", target_id: o.target ?? id, status, reason: o.reason ?? null, priority: o.priority ?? "normal", attempt_count: o.attempts ?? 0, created_at: T0, updated_at: o.at, error: o.error ?? null });
    q("sb1", "pending", { reason: "backfill_video_v2", at: T0 + 10 });
    q("sb2", "failed", { reason: "backfill_video_v2_x", at: T0 + 20, error: "e-video" });
    q("sb3", "dead_letter", { reason: "backfill_event_crew", at: T0 + 30, error: "e-crew" });
    q("sb4", "processing", { reason: "backfill_user_profile_1", at: T0 + 40 });
    q("sb5", "done", { reason: "manual", at: T0 + 50 });
    q("sb6", "failed", { reason: "backfill_unknown", at: T0 + 60, error: "ignored" });
    q("sb7", "pending", { at: T0 + 70 });
    for (let i = 0; i < 90; i += 1) q(`sbx${i}`, "done", { at: T0 + 100 + i, reason: "bulk" });
    sqlite.exec("UPDATE system_settings SET operation_mode = 'economy'");

    const stateJson = JSON.stringify({ schema_version: 1, updated_at: 5, runs: { video_v2: { cursor: "c1", phase: "items", status: "running", total: 9, scanned: 3, enqueued: 2, last_error: "bad", last_run_at: 7 } } });
    const kvFor = (value) => ({ async get(key) { assert.equal(key, core.STATIC_BACKFILL_KV_KEY); if (value instanceof Error) throw value; return value; } });
    const buckets = {
      mixed: { async head(key) { if (key === "videos/random-pool.v1.json") return { size: 1 }; if (key === "top/slot-stats.v1.json") throw new Error("r2 down"); return null; } },
    };

    const refPage = async (kvValue) => {
      const rows = await refDb.select().from(S.staticRebuildQueue).orderBy(desc(S.staticRebuildQueue.updated_at)).limit(80);
      const backfillCountRows = await refDb.select({ reason: S.staticRebuildQueue.reason, status: S.staticRebuildQueue.status, c: sql`COUNT(*)` }).from(S.staticRebuildQueue).where(like(S.staticRebuildQueue.reason, "backfill_%")).groupBy(S.staticRebuildQueue.reason, S.staticRebuildQueue.status);
      const backfillFailureRows = await refDb.select({ reason: S.staticRebuildQueue.reason, error: S.staticRebuildQueue.error }).from(S.staticRebuildQueue).where(and(like(S.staticRebuildQueue.reason, "backfill_%"), inArray(S.staticRebuildQueue.status, ["failed", "dead_letter"]))).orderBy(desc(S.staticRebuildQueue.updated_at)).limit(20);
      const countRows = await refDb.select({ status: S.staticRebuildQueue.status, c: sql`COUNT(*)` }).from(S.staticRebuildQueue).groupBy(S.staticRebuildQueue.status);
      const counts = { pending: 0, processing: 0, failed: 0, dead_letter: 0, done: 0 };
      for (const r of countRows) if (r.status in counts) counts[r.status] = Number(r.c ?? 0);
      const settings = (await refDb.select({ operation_mode: S.systemSettings.operation_mode }).from(S.systemSettings).limit(1))[0];
      const operationMode = resolveOperationMode(settings ?? null);
      const kindOf = (reason) => core.STATIC_BACKFILL_KINDS.find((kind) => reason === `backfill_${kind}` || reason.startsWith(`backfill_${kind}_`)) ?? null;
      const summary = Object.fromEntries(core.STATIC_BACKFILL_KINDS.map((kind) => [kind, { pending: 0, processing: 0, failed: 0, lastError: null }]));
      for (const row of backfillCountRows) {
        const kind = kindOf(String(row.reason ?? ""));
        if (!kind) continue;
        const count = Math.max(0, Number(row.c ?? 0));
        if (row.status === "pending") summary[kind].pending += count;
        if (row.status === "processing") summary[kind].processing += count;
        if (row.status === "failed" || row.status === "dead_letter") summary[kind].failed += count;
      }
      for (const row of backfillFailureRows) {
        const kind = kindOf(String(row.reason ?? ""));
        if (!kind || summary[kind].lastError || !row.error) continue;
        summary[kind].lastError = row.error;
      }
      let backfillState;
      try {
        backfillState = kvValue instanceof Error ? core.createEmptyStaticBackfillState() : kvValue ? core.parseStaticBackfillState(JSON.parse(kvValue)) : core.createEmptyStaticBackfillState();
      } catch {
        backfillState = core.createEmptyStaticBackfillState();
      }
      return canon({
        operationMode, maxItemsPerRun: 1, counts, backfillState, backfillQueue: summary, truncated: false,
        rows: rows.map((r) => pick(r, ["id", "status", "target_type", "target_id", "reason", "priority", "attempt_count", "updated_at", "error"])),
      });
    };
    const fetchPage = async (kvValue, bucket) => {
      const r = await call("/api/admin-read/ops/static-builds", ADMIN, { env: { KV: kvFor(kvValue), BUCKET: bucket } });
      assert.equal(r.status, 200);
      assert.equal(r.stats.statements, 3, "session + 2 (CURRENT 5)");
      assert.equal(r.stats.writes, 0);
      assert.ok(r.text.length <= 64 * 1024);
      const { sharedInputs, ...rest } = r.body;
      return { rest, sharedInputs };
    };
    for (const kvValue of [stateJson, null, "{not json", new Error("kv down")]) {
      const { rest } = await fetchPage(kvValue, undefined);
      assert.deepEqual(rest, await refPage(kvValue), String(kvValue));
    }
    const { rest, sharedInputs } = await fetchPage(stateJson, buckets.mixed);
    assert.equal(rest.rows.length, 80);
    assert.equal(rest.backfillQueue.video_v2.pending, 1);
    assert.equal(rest.backfillQueue.video_v2.failed, 1);
    assert.equal(rest.backfillQueue.video_v2.lastError, "e-video");
    assert.equal(rest.backfillQueue.event_crew.lastError, "e-crew");
    assert.equal(rest.operationMode, "economy");
    assert.deepEqual(
      Object.fromEntries(sharedInputs.map((s) => [s.kind, s.objectState])),
      { youtube_related_blocklist: "missing", random_video_pool: "present", pickup_creators: "missing", top_slot_stats: "unavailable" },
    );
    assert.deepEqual((await fetchPage(stateJson, undefined)).sharedInputs.map((s) => s.objectState), ["unavailable", "unavailable", "unavailable", "unavailable"]);
  });

  test("SEC-799: many backfill reasons aggregate to bounded kind/status counts", async () => {
    const env = { KV: { async get() { return null; } }, BUCKET: { async head() { return null; } } };
    const before = await call("/api/admin-read/ops/static-builds", ADMIN, { env });
    assert.equal(before.status, 200);
    // The previous GROUP BY reason,status returned 150+ distinct rows.
    for (let i = 0; i < 150; i += 1) {
      ins("static_rebuild_queue", {
        id: `sec799-group-${i}`, target_type: "video",
        target_id: `sec799-group-target-${i}`,
        status: i < 110 ? "pending" : "failed", priority: "normal",
        reason: `backfill_video_v2_${i}`, attempt_count: 1,
        created_at: T0 - 50, updated_at: T0 - 50,
      });
    }
    // LIKE '_' is a wildcard; this is *not* a JS-recognized prefix.
    ins("static_rebuild_queue", {
      id: "sec799-group-invalid", target_type: "video",
      target_id: "sec799-group-invalid-target", status: "pending",
      priority: "normal", reason: "backfillXvideo_v2_0",
      attempt_count: 1, created_at: T0 - 50, updated_at: T0 - 50,
    });
    try {
      const aggregateSql = [];
      const d1 = createD1(sqlite);
      const prepare = d1.prepare.bind(d1);
      d1.prepare = (sql) => {
        if (sql.includes("'bf_count' AS kind")) aggregateSql.push(sql);
        return prepare(sql);
      };
      const result = await call("/api/admin-read/ops/static-builds", ADMIN, { env, d1 });
      assert.equal(result.status, 200);
      assert.equal(result.body.backfillQueue.video_v2.pending, before.body.backfillQueue.video_v2.pending + 110);
      assert.equal(result.body.backfillQueue.video_v2.failed, before.body.backfillQueue.video_v2.failed + 40);
      assert.equal(result.body.backfillQueue.user_profile.pending, before.body.backfillQueue.user_profile.pending);
      assert.ok(aggregateSql.length === 1 && aggregateSql[0].includes("GROUP BY a, b") &&
        aggregateSql[0].includes("LIMIT ?"), "aggregate kind/status groups must have a fixed D1 row bound");
      assert.equal(result.stats.statements, 3, "session and two D1 reads");
      assert.equal(result.stats.writes, 0);
      assert.ok(new TextEncoder().encode(result.text).length <= 64 * 1024);
      assert.equal(result.headers.get("cache-control"), "private, no-store");
    } finally {
      sqlite.exec("DELETE FROM static_rebuild_queue WHERE id LIKE 'sec799-group-%'");
    }
  });

  test("SEC-799: invalid LIKE-only failure reasons cannot starve a real backfill error", async () => {
    const env = { KV: { async get() { return null; } }, BUCKET: { async head() { return null; } } };
    const validReason = "backfill_video_v2_sec799";
    const validError = "recognized-video-v2-failure";
    ins("static_rebuild_queue", {
      id: "sec799-shadow-valid", target_type: "video", target_id: "sec799-shadow-valid-target",
      status: "failed", priority: "normal", attempt_count: 1, reason: validReason,
      created_at: T0, updated_at: 4_000_000_000, error: validError,
    });
    // SQL LIKE 'backfill_%' treats '_' as any one character. The 25 newer
    // invalid failures previously occupied all 20 bounded summary rows,
    // so the valid failure above was never shown by the Ops dashboard.
    for (let i = 0; i < 25; i += 1) {
      ins("static_rebuild_queue", {
        id: `sec799-shadow-invalid-${i}`, target_type: "video",
        target_id: `sec799-shadow-invalid-target-${i}`,
        status: "failed", priority: "normal", attempt_count: 1,
        reason: `backfillXvideo_v2_${i}`,
        created_at: T0, updated_at: 4_100_000_000 + i, error: "not-a-backfill-failure",
      });
    }
    try {
      const prepared = [];
      const d1 = createD1(sqlite);
      const originalPrepare = d1.prepare.bind(d1);
      d1.prepare = (sql) => {
        if (sql.includes("'bf_fail' AS kind")) prepared.push(sql);
        return originalPrepare(sql);
      };
      const result = await call("/api/admin-read/ops/static-builds", ADMIN, { env, d1 });
      assert.equal(result.status, 200, result.text.slice(0, 200));
      assert.equal(result.body.backfillQueue.video_v2.lastError, validError);
      assert.ok(prepared.length === 1 && prepared[0].includes("reason GLOB 'backfill_video_v2_*'"),
        "the failure query must use the same exact reason contract as the bounded count query");
      assert.ok(!prepared[0].includes("reason LIKE 'backfill_%'"),
        "LIKE wildcards must not admit non-backfill reasons into the 20-row failure budget");
      assert.equal(result.stats.statements, 3, "session plus two D1 reads");
      assert.equal(result.stats.writes, 0);
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      assert.ok(new TextEncoder().encode(result.text).length <= 64 * 1024);
    } finally {
      sqlite.exec("DELETE FROM static_rebuild_queue WHERE id LIKE 'sec799-shadow-%'");
    }
  });

  test("SEC-799: backfill failure summary and persisted cursor cannot bypass the 64 KiB response budget", async () => {
    const hugeError = "あ".repeat(24_000); // 72,000 UTF-8 bytes, regardless of row-list truncation
    // The D1 boundary itself must not transfer an unlimited diagnostic
    // before the later HTTP/JSON size check runs.
    const kv = (cursor) => ({
      async get() {
        return JSON.stringify({
          schema_version: 1,
          updated_at: 7,
          runs: { video_v2: { status: "running", phase: "items", cursor } },
        });
      },
    });
    const env = (cursor) => ({
      KV: kv(cursor),
      BUCKET: { async head() { return null; } },
    });
    const bodyBytes = (response) => new TextEncoder().encode(response.text).length;
    ins("static_rebuild_queue", {
      id: "sec799-backfill", target_type: "video", target_id: "sec799-target",
      status: "failed", priority: "normal", reason: "backfill_video_v2_799",
      attempt_count: 1, created_at: T0, updated_at: 4_100_000_000, error: hugeError,
    });
    try {
      const seenSql = [];
      const boundedDb = createD1(sqlite);
      const originalPrepare = boundedDb.prepare.bind(boundedDb);
      boundedDb.prepare = (sql) => {
        if (sql.includes("FROM static_rebuild_queue")) seenSql.push(sql);
        return originalPrepare(sql);
      };
      const failed = await call("/api/admin-read/ops/static-builds", ADMIN, {
        d1: boundedDb, env: env("cursor-ok"),
      });
      assert.ok(
        seenSql.some((sql) => /substr\(error, 1, \?\) AS error FROM static_rebuild_queue ORDER BY/.test(sql)),
        "queue rows must be truncated by the SQL reader before entering JS",
      );
      assert.ok(
        seenSql.some((sql) => /SELECT reason, substr\(error, 1, \?\) AS error FROM static_rebuild_queue/.test(sql)),
        "backfill summary errors must be truncated by the SQL reader before entering JS",
      );
      assert.equal(failed.status, 200, failed.text.slice(0, 200));
      assert.ok(bodyBytes(failed) <= 64 * 1024, "the FULL DTO must fit S2, not only rows");
      assert.equal(failed.body.truncated, true, "diagnostic omission must be signalled");
      assert.equal(failed.body.backfillState.runs.video_v2.cursor, "cursor-ok");
      assert.match(failed.body.backfillQueue.video_v2.lastError, /省略/);
      assert.doesNotMatch(failed.text, /あ{100}/, "raw oversized provider diagnostic must not leak");
      assert.equal(failed.stats.statements, 3, "session + 2 D1 reads");
      assert.equal(failed.stats.writes, 0);
      assert.equal(failed.headers.get("cache-control"), "private, no-store");
    } finally {
      sqlite.prepare("DELETE FROM static_rebuild_queue WHERE id = ?").run("sec799-backfill");
    }

    // The mutation endpoint only accepts 128 UTF-16 code units of cursor.
    const safeCursor = "あ".repeat(128);
    const normal = await call("/api/admin-read/ops/static-builds", ADMIN, { env: env(safeCursor) });
    assert.equal(normal.status, 200, "a 128-code-unit mutation-valid cursor must survive unchanged");
    assert.equal(normal.body.backfillState.runs.video_v2.cursor, safeCursor);
    assert.ok(bodyBytes(normal) <= 64 * 1024);
    assert.equal(normal.stats.statements, 3);
    assert.equal(normal.stats.writes, 0);

    // The canonical mutation reader allows up to 64 KiB of raw persisted KV
    // state. Three escaped error strings can exceed 4096 raw characters even
    // with short, valid cursors: do not reject those legitimate checkpoints.
    const escaped = '"'.repeat(1000);
    const validLargeState = JSON.stringify({
      schema_version: 1, updated_at: 7,
      runs: Object.fromEntries(["video_v2", "user_profile", "event_crew"].map(
        (kind) => [kind, { status: "running", phase: "items", cursor: "c-ok", last_error: escaped }],
      )),
    });
    assert.ok(validLargeState.length > 4096, "fixture must exceed the former arbitrary cap");
    assert.ok(new TextEncoder().encode(validLargeState).length <= 64 * 1024);
    const largeValid = await call("/api/admin-read/ops/static-builds", ADMIN, {
      env: { KV: { async get() { return validLargeState; } }, BUCKET: { async head() { return null; } } },
    });
    assert.equal(largeValid.status, 200, "valid KV under 64 KiB must not be lost");
    assert.equal(largeValid.body.backfillState.runs.video_v2.cursor, "c-ok");
    assert.equal(largeValid.body.backfillState.runs.user_profile.last_error, escaped);
    assert.ok(bodyBytes(largeValid) <= 64 * 1024);
    assert.equal(largeValid.stats.statements, 3);
    assert.equal(largeValid.stats.writes, 0);

    const rejected128 = await call("/api/admin-read/ops/static-builds", ADMIN, {
      env: env("あ".repeat(129)),
    });
    assert.equal(rejected128.status, 503, "a stored cursor rejected by POST must not be returned as resumable");
    assert.deepEqual(rejected128.body, { error: "unavailable" });
    assert.equal(rejected128.stats.statements, 3);
    assert.equal(rejected128.stats.writes, 0);

    const unsafeCursor = "あ".repeat(30_000);
    const rejected = await call("/api/admin-read/ops/static-builds", ADMIN, { env: env(unsafeCursor) });
    assert.equal(rejected.status, 503, "never shorten a resume cursor into a different actionable token");
    assert.deepEqual(rejected.body, { error: "unavailable" });
    assert.ok(bodyBytes(rejected) <= 64 * 1024);
    assert.equal(rejected.headers.get("cache-control"), "private, no-store");
    assert.equal(rejected.stats.statements, 3);
    assert.equal(rejected.stats.writes, 0);
    assert.doesNotMatch(rejected.text, /あ{100}/);
  });

  test("T02 health (operational view) equals CURRENT and deep diagnostics are allowlisted per check", async () => {
    const { runOperationalHealthChecks } = await import("../../../src/lib/admin/healthChecks.ts");
    ins("x_identity_requests", { id: "xs1", request_type: "merge", status: "pending", requested_by_auth_user_id: "u_alice", source_x_user_id: "alice_x", target_x_user_id: "alice_y", requested_at: nowS - 9 * 86400, updated_at: nowS });
    ins("x_identity_requests", { id: "xs2", request_type: "merge", status: "pending", requested_by_auth_user_id: "u_alice", source_x_user_id: "frank_x", target_x_user_id: "frank_y", requested_at: nowS - 8 * 86400, updated_at: nowS });
    ins("x_identity_requests", { id: "xs3", request_type: "merge", status: "pending", requested_by_auth_user_id: "u_alice", source_x_user_id: "a", target_x_user_id: "b", requested_at: nowS - 100, updated_at: nowS });
    ins("video_moderation_cases", { id: "mc-late", video_id: "va4", case_type: "void", status: "open", due_at: nowS - 50, created_at: T0 });
    for (let i = 0; i < 22; i += 1) notif(`nf${i}`, "video_bulk", "failed", { at: T0 + 500 + i });
    const strip = (list) => list.map(({ note, ...rest }) => ({ ...rest, ...(note ? { note } : {}) }));
    const r = await get("/ops/health");
    assert.deepEqual(r.body, { status: "all", results: canon(strip(await runOperationalHealthChecks(refDb))), error: null });
    assert.equal(r.stats.statements, 2, "session + 1 (CURRENT 9 queries)");
    const byId = Object.fromEntries(r.body.results.map((x) => [x.id, x]));
    assert.equal(byId.notification_failed_volume.status, "warn");
    assert.ok(byId.x_id_merge_pending_stale.count >= 2 && byId.open_moderation_cases_overdue.count >= 1);
    assert.equal((await get("/ops/health?status=info")).body.status, "info");

    const { HEALTH_CHECK_IDS, runHealthChecks, runAuthLikeCountDriftCandidate } = await import("@flamenode/server-core/admin/healthChecks");
    const deep = await call("/api/admin-read/ops/health?deep=1", ADMIN);
    assert.equal(deep.status, 200);
    assert.deepEqual(deep.body, { status: "all", results: [], error: null, checkIds: [...HEALTH_CHECK_IDS] });
    assert.equal(deep.headers.get("cache-control"), "private, no-store");
    assert.equal(deep.stats.statements, 1, "catalog only performs the session lookup");
    assert.deepEqual((await call("/api/admin-read/ops/health?run=1", ADMIN)).body, deep.body);
    assert.equal(new Set(HEALTH_CHECK_IDS).size, 22);
    // Next treats repeated query keys as arrays; a repeated value is not a
    // scalar opt-in or filter. The other valid alias remains independent.
    for (const [query, expectedStatus, expectedDeep] of [
      ["deep=1&deep=1", "all", false],
      ["deep=1&deep=0", "all", false],
      ["deep=0&deep=1", "all", false],
      ["run=1&run=1", "all", false],
      ["run=1&run=0", "all", false],
      ["run=0&run=1", "all", false],
      ["deep=1&deep=1&run=1&run=1", "all", false],
      ["deep=1&deep=0&run=1", "all", true],
      ["run=1&run=0&deep=1", "all", true],
      ["deep=01&run=0", "all", false],
      ["status=warn&status=warn", "all", false],
      ["status=warn&status=ok", "all", false],
      ["status=ok&status=warn&deep=1", "all", true],
      ["status=info&deep=1&deep=0", "info", false],
      ["status=warn&run=1", "warn", true],
      ["status=ok&deep=1", "ok", true],
    ]) {
      const receipt = await call("/api/admin-read/ops/health?" + query, ADMIN);
      assert.equal(receipt.status, 200, query);
      assert.deepEqual(receipt.body, { ...(expectedDeep ? deep.body : r.body), status: expectedStatus }, query);
      assert.equal(receipt.headers.get("cache-control"), "private, no-store", query);
      assert.equal(receipt.stats.statements, expectedDeep ? 1 : 2, query);
      assert.equal(receipt.stats.writes, 0, query);
    }
    // More than the 10 returned samples: window COUNT must still reflect all
    // eligible rows, not just the LIMIT 10 subset or the 5 UI samples.
    for (let i = 0; i < 12; i++) {
      ins("audit_logs", {
        id: "retention-window-" + i, table_name: "retention_test",
        target_id: "test", operation: "UPDATE", actor_user_id: "u_carol",
        created_at: T0 - 10000 - i,
      });
    }
    const daysRow = sqlite.prepare("SELECT audit_normal_retention_days AS days FROM system_settings LIMIT 1").get();
    const retentionDays = Math.max(7, Number(daysRow?.days ?? 30) || 30);
    const retentionCutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    const expectedRetention = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE (retention_class IS NULL OR retention_class = 'normal') AND created_at < ?"
    ).get(retentionCutoff).n;
    assert.ok(expectedRetention >= 12, "fixture exercises COUNT beyond LIMIT 10");
    const fullResults = await runHealthChecks(refDb);
    const authLikeCandidate = await runAuthLikeCountDriftCandidate(refDb);
    for (const id of HEALTH_CHECK_IDS) {
      const result = await call("/api/admin-read/ops/health/checks/" + encodeURIComponent(id), ADMIN);
      assert.equal(result.status, 200, id + " " + result.text.slice(0, 200));
      // The Hono like-count route intentionally carries the Lead-scoped Auth-authority candidate;
      // the shared Next helper remains the explicit legacy reference until independent review.
      const expectedResults = id === "like_count_drift"
        ? [authLikeCandidate]
        : fullResults.filter((row) => row.id === id);
      assert.deepEqual(canon(result.body), canon({ status: "all", results: expectedResults, error: null }), id);
      if (id === "audit_logs_retention_candidates") {
        assert.equal(result.body.results[0]?.count, expectedRetention,
          "COUNT(*) OVER () covers all eligible rows even with sample LIMIT 5");
        assert.equal(result.body.results[0]?.samples.length, 5,
          "the query must return exactly the five displayed retention samples");
      }
      assert.equal(result.headers.get("cache-control"), "private, no-store", id);
      assert.equal(result.stats.writes, 0, id);
      // Every check, including audit retention, has a session + at most 2 D1
      // reads. The retention count and sample share a window-count query.
      assert.ok(result.stats.statements <= 3,
        id + ": session + at most 2 per-check D1 reads (S2 maximum 3)");
      if (id === "audit_logs_retention_candidates") {
        assert.equal(result.stats.statements, 3,
          "retention: session + settings + combined count/sample");
      }
    }
    const unknown = await call("/api/admin-read/ops/health/checks/unknown_check", ADMIN);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.stats.statements, 1);
    const denied = await call("/api/admin-read/ops/health/checks/like_count_drift", "tok-alice");
    assert.equal(denied.status, 403);
    assert.equal(denied.stats.statements, 1);

    // A per-check D1 failure is a fixed 503; never disclose SQL, credentials, or raw provider errors.
    const deepFailD1 = createD1(sqlite);
    const originalDeepPrepare = deepFailD1.prepare;
    deepFailD1.prepare = (statement) => {
      if (/video_events/.test(statement)) throw new Error("secret-d1-internal-not-for-client");
      return originalDeepPrepare(statement);
    };
    const deepFailure = await call("/api/admin-read/ops/health/checks/primary_event_sync", ADMIN, { d1: deepFailD1 });
    assert.equal(deepFailure.status, 503);
    assert.deepEqual(deepFailure.body, { error: "unavailable" });
    assert.equal(deepFailure.headers.get("cache-control"), "private, no-store");
    assert.equal(deepFailure.stats.writes, 0);
    assert.doesNotMatch(deepFailure.text, /secret-d1-internal-not-for-client|SELECT|video_events/);

    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/notification_failed_volume/.test(text)) throw new Error("secret-internal");
      return prepare(text);
    };
    const failed = await call("/api/admin-read/ops/health", ADMIN, { d1 });
    assert.equal(failed.status, 200);
    assert.deepEqual(failed.body, { status: "all", results: [], error: "query_failed" });
    assert.doesNotMatch(failed.text, /secret-internal/);
  });

  test("MIG-0626 U06: preserve the legacy X receipt separately and verify the Auth-authority Hono candidate", async () => {
    const { runHealthCheckById } = await import("@flamenode/server-core/admin/healthChecks");
    const endpoint = "/api/admin-read/ops/health/checks/like_count_drift";
    const prefix = "mig0626-like-auth-";
    const authIds = Array.from({ length: 120 }, (_, i) => prefix + "auth-" + i);
    const xId = (i) => prefix + "x-" + i;
    const label = "like_count 実数差分 (閾値 max(±5, ±5%))";
    const authNote = "保存されているいいね数と Auth User 単位の video_interactions_auth 実数が大きくズレている作品があります。";
    const cases = [
      ["00-zero", 0, 5, 5, 0],
      ["abs-below", 4, 0, 0, 0],
      ["04-abs-equal", 5, 0, 0, 0],
      ["03-abs-above", 6, 0, 0, 0],
      ["ratio-below", 105, 110, 110, 0],
      ["ratio-equal", 104, 110, 110, 0],
      ["02-ratio-above", 103, 110, 110, 0],
      ["01-ratio-tie", 95, 100, 100, 0],
      ["auth-healthy-legacy-empty", 6, 0, 6, 0],
      ["legacy-masks-auth-drift", 5, 5, 0, 0],
      ["bookmarks-not-likes", 5, 0, 0, 8],
    ];
    const video = (id, stored) => ins("videos", {
      id, title: id, creator_display_name: "fixture", submitted_by_user_id: "u_carol",
      visibility_status: "private", app_like_count: stored, created_at: T0,
    });
    const legacyInteraction = (id, i, type) => ins("video_interactions", {
      x_user_id: xId(i), video_id: id, interaction_type: type, created_at: T0,
    });
    const authInteraction = (id, i, type) => ins("video_interactions_auth", {
      auth_user_id: authIds[i], video_id: id, interaction_type: type, created_at: T0,
    });
    const measure = async (token = ADMIN) => {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      const projections = [];
      const candidateSql = [];
      d1.prepare = (statement) => {
        if (!/WITH\s+observed\s+AS\s+MATERIALIZED/i.test(statement)) return prepare(statement);
        candidateSql.push(statement);
        const wrap = (stmt) => {
          let recorded = false;
          const record = (rows) => {
            if (recorded) return;
            recorded = true;
            const data = Array.isArray(rows) ? rows : [];
            projections.push({
              rows: data.length,
              bytes: Buffer.byteLength(JSON.stringify(data)),
              sampleIds: data.map((row) => Array.isArray(row) ? row[2] : row.id),
            });
          };
          return {
            ...stmt,
            bind: (...args) => wrap(stmt.bind(...args)),
            async raw(options) {
              const rows = await stmt.raw(options);
              record(options?.columnNames ? rows.slice(1) : rows);
              return rows;
            },
            async all() {
              const result = await stmt.all();
              record(result.results ?? result);
              return result;
            },
          };
        };
        return wrap(prepare(statement));
      };
      return {
        ...(await call(endpoint, token, { d1 })),
        projections,
        sql: candidateSql[0],
      };
    };
    const expected = (status, count, samples) => ({
      status: "all",
      results: [{
        id: "like_count_drift", label, status, count, samples,
        ...(count > 0 ? { note: authNote } : {}),
      }],
      error: null,
    });
    const assertReadOnly = (receipt, statements, projectedRows) => {
      assert.equal(receipt.status, 200);
      assert.equal(receipt.headers.get("cache-control"), "private, no-store");
      assert.equal(receipt.stats.statements, statements);
      assert.equal(receipt.stats.writes, 0);
      assert.ok(Buffer.byteLength(receipt.text) <= 64 * 1024);
      assert.equal(receipt.projections.length, 1);
      assert.equal(receipt.projections[0].rows, projectedRows);
      assert.ok(receipt.projections[0].bytes < 8 * 1024);
      assert.match(receipt.sql, /video_interactions_auth/);
      assert.doesNotMatch(receipt.sql, /FROM\s+"?video_interactions"?(?:\s|$)/i);
      assert.match(receipt.sql, /ORDER BY id/i);
      assert.match(receipt.sql, /LIMIT 5/i);
    };

    sqlite.exec("SAVEPOINT mig0626_like_auth_candidate");
    try {
      sqlite.exec("UPDATE videos SET app_like_count = 0");
      sqlite.exec("DELETE FROM video_interactions_auth");
      sqlite.exec("DELETE FROM video_interactions");
      for (let i = 0; i < 110; i++) {
        ins("x_users", { id: xId(i), x_name: xId(i), approval_status: "approved" });
      }
      for (let i = 0; i < authIds.length; i++) {
        ins("user", {
          id: authIds[i], name: authIds[i], email: authIds[i] + "@example.test",
          role: "user", created_at: T0,
        });
      }

      const empty = await measure();
      assertReadOnly(empty, 2, 1);
      assert.deepEqual(empty.body, expected("ok", 0, []));

      for (const [suffix, stored, legacyLikes, authLikes, authBookmarks] of cases) {
        const id = prefix + suffix;
        video(id, stored);
        for (let i = 0; i < legacyLikes; i++) legacyInteraction(id, i, "like");
        for (let i = 0; i < authLikes; i++) authInteraction(id, i, "like");
        for (let i = 0; i < authBookmarks; i++) {
          legacyInteraction(id, i, "bookmark");
          authInteraction(id, i, "bookmark");
        }
      }

      // The shared CURRENT helper remains a pinned X-authority reference:
      // it excludes stored=0, trusts legacy X rows, and ignores Auth rows.
      const legacy = await runHealthCheckById(refDb, "like_count_drift");
      assert.equal(legacy?.count, 7);
      assert.equal(legacy?.samples.length, 5);
      const legacyVideoRows = sqlite.prepare(
        "SELECT id, app_like_count AS stored FROM videos WHERE app_like_count >= 1",
      ).all();
      const legacyInteractionRows = sqlite.prepare(
        "SELECT video_id, COUNT(*) AS cnt FROM video_interactions WHERE interaction_type = 'like' GROUP BY video_id",
      ).all();
      const legacyMap = new Map(legacyInteractionRows.map((row) => [row.video_id, Number(row.cnt)]));
      const legacyDriftIds = new Set();
      for (const row of legacyVideoRows) {
        const actual = legacyMap.get(row.id) ?? 0;
        const ratioThreshold = Math.ceil(actual / 20);
        const threshold = Math.max(5, ratioThreshold);
        if (Math.abs(Number(row.stored) - actual) >= threshold) legacyDriftIds.add(row.id);
      }
      assert.ok(!legacyVideoRows.some((row) => row.id === prefix + "00-zero"), "legacy excludes stored zero");
      assert.ok(legacyDriftIds.has(prefix + "auth-healthy-legacy-empty"), "legacy reports a healthy Auth count as drift");
      assert.ok(!legacyDriftIds.has(prefix + "legacy-masks-auth-drift"), "legacy rows can mask an Auth-authority drift");
      assert.ok(legacyDriftIds.has(prefix + "bookmarks-not-likes"), "legacy bookmark rows do not count as likes");

      const first = await measure();
      assertReadOnly(first, 2, 5);
      assert.deepEqual(first.body, expected("warn", 8, [
        "video:" + prefix + "00-zero stored:0 actual:5 diff:5 threshold:5 [abs(5)]",
        "video:" + prefix + "01-ratio-tie stored:95 actual:100 diff:5 threshold:5 [ratio(5)]",
        "video:" + prefix + "02-ratio-above stored:103 actual:110 diff:7 threshold:6 [ratio(6)]",
        "video:" + prefix + "03-abs-above stored:6 actual:0 diff:6 threshold:5 [abs(5)]",
        "video:" + prefix + "04-abs-equal stored:5 actual:0 diff:5 threshold:5 [abs(5)]",
      ]));

      // More than 100 healthy rows plus seven drifts: count all, transfer five.
      for (let i = 0; i < 120; i++) {
        const id = prefix + "zz-healthy-" + String(i).padStart(3, "0");
        video(id, 1);
        legacyInteraction(id, 0, "like");
        authInteraction(id, 0, "like");
      }
      for (let i = 0; i < 7; i++) video(prefix + "zz-aggregate-" + i, 6);
      const oldTransferRows = sqlite.prepare(
        "SELECT id, app_like_count AS stored FROM videos WHERE app_like_count >= 1",
      ).all();
      const oldTransferInteractions = sqlite.prepare(
        "SELECT video_id, COUNT(*) AS cnt FROM video_interactions WHERE interaction_type = 'like' GROUP BY video_id",
      ).all();
      assert.ok(oldTransferRows.length > 100);
      assert.ok(oldTransferInteractions.length > 100);
      assert.ok(Buffer.byteLength(JSON.stringify(oldTransferRows)) > 0);
      assert.ok(Buffer.byteLength(JSON.stringify(oldTransferInteractions)) > 0);

      const many = await measure();
      assertReadOnly(many, 2, 5);
      assert.deepEqual(many.body, expected("warn", 15, [
        "video:" + prefix + "00-zero stored:0 actual:5 diff:5 threshold:5 [abs(5)]",
        "video:" + prefix + "01-ratio-tie stored:95 actual:100 diff:5 threshold:5 [ratio(5)]",
        "video:" + prefix + "02-ratio-above stored:103 actual:110 diff:7 threshold:6 [ratio(6)]",
        "video:" + prefix + "03-abs-above stored:6 actual:0 diff:6 threshold:5 [abs(5)]",
        "video:" + prefix + "04-abs-equal stored:5 actual:0 diff:5 threshold:5 [abs(5)]",
      ]));

      const invalidId = prefix + "zz-invalid-counter";
      video(invalidId, "Infinity");
      const invalid = await measure();
      assert.equal(invalid.status, 503);
      assert.deepEqual(invalid.body, { error: "unavailable" });
      assert.equal(invalid.headers.get("cache-control"), "private, no-store");
      assert.equal(invalid.stats.statements, 2);
      assert.equal(invalid.stats.writes, 0);
      assert.doesNotMatch(invalid.text, /Infinity|invalid-counter/);
      sqlite.prepare("DELETE FROM videos WHERE id = ?").run(invalidId);

      const oversizedId = "!" + "x".repeat(256);
      video(oversizedId, 6);
      const oversized = await measure();
      assert.equal(oversized.status, 503);
      assert.deepEqual(oversized.body, { error: "unavailable" });
      assert.equal(oversized.headers.get("cache-control"), "private, no-store");
      assert.equal(oversized.stats.statements, 2);
      assert.equal(oversized.stats.writes, 0);
      assert.doesNotMatch(oversized.text, /xxxxxxxxxxxxxxxxxxxx/);
      sqlite.prepare("DELETE FROM videos WHERE id = ?").run(oversizedId);

      // Isolate each sampled identifier: no healthy or later-sort BLOB may
      // accidentally evade the actual first-five sample projection.
      sqlite.exec("SAVEPOINT mig0626_like_id_bytes");
      try {
        sqlite.exec("UPDATE videos SET app_like_count = 0; DELETE FROM video_interactions_auth");
        const fixtureId = prefix + "zz-id-byte-fixture";
        const idCases = [];
        for (const unit of ["x", "é", "あ", "🚀"]) {
          for (const size of [255, 256, 257]) {
            const width = Buffer.byteLength(unit);
            const value = "!" + unit.repeat(Math.floor((size - 1) / width)) + "x".repeat((size - 1) % width);
            assert.equal(Buffer.byteLength(value), size);
            idCases.push({ raw: Buffer.from(value), decoded: value, storage: "text", size });
          }
        }
        // Stored malformed UTF-8 is within 256 bytes but its local adapter
        // replacement decoding can exceed that limit. Keep valid decoded
        // boundary strings intact; never return an over-bound sample.
        for (const [count, tail] of [[84, 2], [85, 0], [85, 1], [86, 0]]) {
          const raw = Buffer.concat([Buffer.from("!"), Buffer.alloc(count, 0xff), Buffer.alloc(tail, 120)]);
          const decoded = "!" + "\uFFFD".repeat(count) + "x".repeat(tail);
          idCases.push({ raw, decoded, storage: "text", size: raw.length });
        }
        for (const size of [0, 7, 256, 257]) {
          idCases.push({ raw: Buffer.alloc(size, 120), decoded: null, storage: "blob", size });
        }
        for (const { raw, decoded, storage, size } of idCases) {
          video(fixtureId, 6);
          const valueSql = storage === "text" ? "CAST(? AS TEXT)" : "?";
          sqlite.prepare("UPDATE videos SET id = " + valueSql + " WHERE id = ?").run(raw, fixtureId);
          const stored = sqlite.prepare("SELECT typeof(id) AS storage, length(CAST(id AS BLOB)) AS bytes FROM videos WHERE title = ?").get(fixtureId);
          assert.equal(stored.storage, storage);
          assert.equal(stored.bytes, size);
          const receipt = await measure();
          const accepted = storage === "text" && size <= 256 && Buffer.byteLength(decoded) <= 256;
          assert.equal(receipt.projections.length, 1);
          assert.equal(receipt.projections[0].rows, 1);
          assert.deepEqual(receipt.projections[0].sampleIds, [
            storage === "text" && size <= 256 ? decoded : null,
          ], "actual SQL projection");
          if (accepted) {
            assertReadOnly(receipt, 2, 1);
            assert.deepEqual(receipt.body, expected("warn", 1, [
              "video:" + decoded + " stored:6 actual:0 diff:6 threshold:5 [abs(5)]",
            ]));
          } else {
            assert.equal(receipt.status, 503);
            assert.deepEqual(receipt.body, { error: "unavailable" });
            assert.equal(receipt.headers.get("cache-control"), "private, no-store");
            assert.equal(receipt.stats.statements, 2);
            assert.equal(receipt.stats.writes, 0);
          }
          sqlite.prepare("DELETE FROM videos WHERE title = ?").run(fixtureId);
        }
      } finally {
        sqlite.exec("ROLLBACK TO mig0626_like_id_bytes; RELEASE mig0626_like_id_bytes");
      }

      const denied = await measure("tok-alice");
      assert.equal(denied.status, 403);
      assert.equal(denied.stats.statements, 1);
      assert.equal(denied.stats.writes, 0);
      assert.deepEqual(denied.projections, []);
    } finally {
      sqlite.exec("ROLLBACK TO mig0626_like_auth_candidate; RELEASE mig0626_like_auth_candidate");
    }
  });

  test("MIG-0626 U06: retention diagnosis bounds the entire UTF-8 JSON response without changing samples or count", async () => {
    const path = "/api/admin-read/ops/health/checks/audit_logs_retention_candidates";
    const prefix = "retention-byte-bound-";
    const ids = Array.from({ length: 5 }, (_, i) => prefix + i);
    const encoder = new TextEncoder();
    const size = (receipt) => encoder.encode(receipt.text).length;
    const limit = 64 * 1024;
    const update = sqlite.prepare("UPDATE audit_logs SET table_name = ? WHERE id = ?");
    try {
      for (let i = 0; i < ids.length; i++) {
        ins("audit_logs", {
          id: ids[i], table_name: "seed", target_id: "test", operation: "UPDATE",
          actor_user_id: "u_carol", created_at: i + 1, retention_class: "normal",
        });
      }
      const baseline = await call(path, ADMIN);
      assert.equal(baseline.status, 200);
      assert.deepEqual(baseline.body.results[0].samples, ids.map((id) => id + " seed"));
      const exact = "a".repeat(limit - size(baseline) + "seed".length);
      for (const [label, values, accepted] of [
        ["exact limit", [exact], true],
        ["one byte over", [exact + "a"], false],
        ["oversized input", ["private-sample-" + "a".repeat(70_000)], false],
        ["multibyte", ["private-sample-" + "あ".repeat(22_000)], false],
        ["escaped controls", ["private-sample-" + "\u0001".repeat(11_000)], false],
        ["aggregate five samples", ids.map(() => "private-sample-" + "あ".repeat(4_500)), false],
        ["valid multibyte", ["あ".repeat(10_000)], true],
      ]) {
        const names = ids.map((_, i) => values[i] ?? "seed");
        for (let i = 0; i < ids.length; i++) update.run(names[i], ids[i]);
        const receipt = await call(path, ADMIN);
        assert.equal(receipt.status, accepted ? 200 : 503, label);
        assert.ok(size(receipt) <= limit, label);
        assert.equal(receipt.headers.get("cache-control"), "private, no-store", label);
        assert.equal(receipt.stats.statements, 3, label + ": session + settings + count/sample");
        assert.equal(receipt.stats.writes, 0, label);
        if (accepted) {
          assert.equal(receipt.body.results[0].count, baseline.body.results[0].count, label);
          assert.deepEqual(receipt.body.results[0].samples, ids.map((id, i) => id + " " + names[i]), label);
          if (label === "exact limit") assert.equal(size(receipt), limit);
        } else {
          assert.deepEqual(receipt.body, { error: "unavailable" }, label);
          assert.doesNotMatch(receipt.text, /private-sample-|retention-byte-bound-/);
        }
      }
    } finally {
      for (const id of ids) sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run(id);
    }
  });

  test("T02 integrity: idle catalog and run=1 are read-only; per-check results match full CURRENT helper", async () => {
    const { runIntegrityChecks, INTEGRITY_CHECK_IDS } = await import(
      "@flamenode/server-core/admin/integrityChecks"
    );
    const idle = await get("/ops/integrity");
    assert.deepEqual(idle.body, { ran: false, results: [], checkIds: [...INTEGRITY_CHECK_IDS] });
    assert.equal(idle.stats.statements, 1, "catalog must only read the session");
    assert.equal(new Set(INTEGRITY_CHECK_IDS).size, INTEGRITY_CHECK_IDS.length, "unique allowlisted check IDs");
    const requested = await call("/api/admin-read/ops/integrity?run=1", ADMIN);
    assert.deepEqual(requested.body, idle.body);
    assert.equal(requested.headers.get("cache-control"), "private, no-store");
    assert.equal(requested.stats.statements, 1);
    assert.equal((await call("/api/admin-read/ops/integrity", "tok-alice")).status, 403);

    // The same read-only CURRENT business logic is still used by Next via its compatibility bridge.
    // Run it once as the reference and make every Hono per-ID request execute only its selected check.
    const expected = await runIntegrityChecks(refDb);
    for (const id of INTEGRITY_CHECK_IDS) {
      const result = await call("/api/admin-read/ops/integrity/" + encodeURIComponent(id), ADMIN);
      assert.equal(result.status, 200, id);
      assert.equal(result.headers.get("cache-control"), "private, no-store", id);
      const expectedResults = expected.filter((check) => check.id === id).map((check) => (
        id === "staff_manager_has_dangerous_permissions"
          ? { ...check, issues: [...check.issues].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
          : check
      ));
      assert.deepEqual(canon(result.body), canon({
        ran: true,
        results: expectedResults,
      }), id);
      assert.ok(result.stats.statements <= 2, id + ": session + at most one check query");
    }
    const missing = await call("/api/admin-read/ops/integrity/unknown_check", ADMIN);
    assert.equal(missing.status, 404);
    assert.equal(missing.stats.statements, 1, "unknown check must not query the DB");
    const denied = await call("/api/admin-read/ops/integrity/videos_primary_event_missing_event", "tok-alice");
    assert.equal(denied.status, 403);
    assert.equal(denied.stats.statements, 1, "denial occurs before the check");
  });

  test("MIG-0626 U05/U06: every allowlisted diagnostic rejects D1 failures and unauthorized callers without leaking details", async () => {
    const { HEALTH_CHECK_IDS } = await import("@flamenode/server-core/admin/healthChecks");
    const { INTEGRITY_CHECK_IDS } = await import("@flamenode/server-core/admin/integrityChecks");
    const secret = "synthetic-private-provider-error tok-carol";
    const catalogs = [
      ["/api/admin-read/ops/health/checks/", HEALTH_CHECK_IDS],
      ["/api/admin-read/ops/integrity/", INTEGRITY_CHECK_IDS],
    ];
    // Three CURRENT health checks are static receipts; they must never
    // attempt a diagnostic D1 read. Fourteen use Promise.all for count/sample,
    // so a failed first query does not cancel an already-started sibling.
    const staticHealth = new Set([
      "video_statistics_columns", "chapter_non_chapter_marker", "public_api_event_flag",
    ]);
    const staticIntegrity = new Set(["staff_owner_missing_permissions"]);
    const parallelHealth = new Set([
      "primary_event_sync", "orphan_event_ref", "orphan_video_ref",
      "available_slot_with_video", "submitted_slot_without_video",
      "public_video_without_youtube_id", "voided_video_visible",
      "missing_video_youtube_metadata", "videos_outro_comment_legacy",
      "orphan_video_member", "notification_processing_stuck",
      "notification_failed_volume", "open_moderation_cases_overdue",
      "x_id_merge_pending_stale",
    ]);
    // Count actual prepare attempts separately from successful harness reads.
    // The first prepared statement is the real session lookup. Fail the
    // requested diagnostic on execution (including Drizzle's raw() path).
    function faultAt(failAt, duringPrepare = false) {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      let attempts = 0;
      let failures = 0;
      d1.prepare = (sql) => {
        attempts++;
        if (attempts !== failAt) return prepare(sql);
        const fail = () => {
          failures++;
          throw new Error(secret + " " + sql);
        };
        if (duringPrepare) return fail();
        const wrap = (stmt) => ({
          ...stmt,
          bind: (...args) => wrap(stmt.bind(...args)),
          async raw() { return fail(); },
          async all() { return fail(); },
          async first() { return fail(); },
        });
        return wrap(prepare(sql));
      };
      return { d1, attempts: () => attempts, failures: () => failures };
    }
    const noStore = (receipt) => {
      assert.equal(receipt.headers.get("cache-control"), "private, no-store");
      assert.equal(receipt.stats.writes, 0);
      assert.doesNotMatch(receipt.text, /synthetic-private-provider-error|tok-carol|SELECT\b/);
    };
    const unavailable = (receipt, fault, expectedAttempts, context) => {
      assert.equal(receipt.status, 503, context);
      assert.deepEqual(receipt.body, { error: "unavailable" }, context);
      assert.equal(fault.attempts(), expectedAttempts, context);
      assert.equal(fault.failures(), 1, context);
      assert.equal(receipt.stats.statements, expectedAttempts - 1, context);
      noStore(receipt);
    };
    assert.equal(HEALTH_CHECK_IDS.length, 22);
    assert.equal(INTEGRITY_CHECK_IDS.length, 36);
    const deniedTokens = ["tok-alice", "tok-mod", "tok-banned", "tok-expired", "tok-nope", null];
    for (const [prefix, ids] of catalogs) {
      for (const [index, id] of ids.entries()) {
        const path = prefix + encodeURIComponent(id);
        const fault = faultAt(2, index % 2 === 0);
        const actual = await call(path, ADMIN, { d1: fault.d1 });
        const health = ids === HEALTH_CHECK_IDS;
        const staticNoRead = health ? staticHealth.has(id) : staticIntegrity.has(id);
        if (staticNoRead) {
          assert.equal(actual.status, 200, id);
          if (health) {
            assert.equal(actual.body.error, null, id);
            assert.equal(actual.body.results.length, 1, id);
            assert.deepEqual(
              { id: actual.body.results[0].id, status: actual.body.results[0].status,
                count: actual.body.results[0].count, samples: actual.body.results[0].samples },
              { id, status: "ok", count: 0, samples: [] }, id,
            );
          } else {
            assert.deepEqual(actual.body.results, [], id);
          }
          assert.equal(fault.attempts(), 1, id);
          assert.equal(fault.failures(), 0, id);
          assert.equal(actual.stats.statements, 1, id);
          noStore(actual);
        } else {
          unavailable(actual, fault, health && parallelHealth.has(id) ? 3 : 2, id);
          if (health && parallelHealth.has(id)) {
            // The other half may fail too: no successful partial diagnosis.
            const second = faultAt(3, index % 2 !== 0);
            unavailable(await call(path, ADMIN, { d1: second.d1 }), second, 3, id + ": sibling failure");
          }
        }
        const token = deniedTokens[index % deniedTokens.length];
        const deniedFault = faultAt(2);
        const denied = await call(path, token, { d1: deniedFault.d1 });
        assert.equal(denied.status, index % deniedTokens.length < 3 ? 403 : 401, id);
        assert.equal(deniedFault.failures(), 0, id);
        assert.equal(deniedFault.attempts(), token === null ? 0 : 1, id);
        assert.equal(denied.stats.statements, token === null ? 0 : 1, id);
        noStore(denied);
      }
      for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty", "not_a_check", "like_count_drift/extra"]) {
        const fault = faultAt(2);
        const receipt = await call(prefix + encodeURIComponent(id), ADMIN, { d1: fault.d1 });
        assert.equal(receipt.status, 404, id);
        assert.deepEqual(receipt.body, { error: "not_found" }, id);
        assert.equal(fault.attempts(), 1, id);
        assert.equal(fault.failures(), 0, id);
        assert.equal(receipt.stats.statements, 1, id);
        noStore(receipt);
      }
    }
    // Retention performs a settings read before the combined count/sample
    // statement; the later failure must not return partial or healthy data.
    const retention = faultAt(3);
    unavailable(await call("/api/admin-read/ops/health/checks/audit_logs_retention_candidates", ADMIN, {
      d1: retention.d1,
    }), retention, 3, "retention second diagnostic read");
  });

  test("MIG-0626 U06: operational health and security bound the entire multi-check diagnostic response", async () => {
    // Execute the actual read statements and inject synthetic oversized values
    // at the D1 result boundary. No persistent fixture or SQL is changed.
    function withSamples(overrides) {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      d1.prepare = (sql) => {
        const selected = Object.entries(overrides).filter(([id]) => sql.includes("'" + id + "'"));
        const wrap = (statement) => {
          if (!selected.length) return statement;
          return {
            ...statement,
            bind: (...values) => wrap(statement.bind(...values)),
            async all() {
              const receipt = await statement.all();
              return {
                ...receipt,
                results: [
                  ...receipt.results.filter((row) => !selected.some(([id]) => id === row.check_id)),
                  ...selected.map(([id, value]) => ({
                    check_id: id, total_count: 1, a: value, b: "seed-ref", c: null,
                  })),
                ],
              };
            },
          };
        };
        return wrap(prepare(sql));
      };
      return d1;
    }
    const encoder = new TextEncoder();
    const limit = 64 * 1024;
    const size = (receipt) => encoder.encode(receipt.text).length;
    const configs = [
      {
        path: "/api/admin-read/ops/health", idle: "?deep=1", statements: 2,
        first: "notification_failed_volume", second: "open_moderation_cases_overdue",
        firstSample: (value) => value + " (seed-ref)",
        secondSample: (value) => value + " video:seed-ref",
      },
      {
        path: "/api/admin-read/ops/security", query: "?run=1", idle: "?run=1&run=1", statements: 3,
        first: "rejected_xid_active", second: "banned_user_videos",
        firstSample: (value) => "user:" + value + " x:seed-ref",
        secondSample: (value) => "video:" + value + " submitter:seed-ref",
      },
    ];
    for (const config of configs) {
      const request = (first, second) => call(config.path + (config.query ?? ""), ADMIN, {
        d1: withSamples({ [config.first]: first, [config.second]: second }),
      });
      const baseline = await request("seed", "seed");
      assert.equal(baseline.status, 200, config.path);
      assert.deepEqual(baseline.body.results.find((r) => r.id === config.first).samples, [config.firstSample("seed")]);
      assert.deepEqual(baseline.body.results.find((r) => r.id === config.second).samples, [config.secondSample("seed")]);
      const exact = "a".repeat(limit - size(baseline) + "seed".length);
      for (const [label, first, second, accepted] of [
        ["exact limit", exact, "seed", true],
        ["one byte over", exact + "a", "seed", false],
        ["oversized ASCII", "private-diagnostic-" + "a".repeat(70_000), "seed", false],
        ["multibyte", "private-diagnostic-" + "あ".repeat(22_000), "seed", false],
        ["escaped controls", "private-diagnostic-" + "\u0001".repeat(11_000), "seed", false],
        ["aggregate across checks", "private-diagnostic-" + "あ".repeat(11_000), "あ".repeat(11_000), false],
        ["valid multibyte", "あ".repeat(10_000), "seed", true],
        ["surrogate pair across chunk boundary", "a".repeat(4095 - (config.path.endsWith("/security") ? "user:".length : 0)) + "🚀" + "a".repeat(8192), "seed", true],
        ["lone surrogate escapes", "\uD800".repeat(5000) + "\uDC00", "seed", true],
        ["escaped exact byte boundary", "\u0001".repeat(Math.floor(exact.length / 6)) + "a".repeat(exact.length % 6), "seed", true],
        ["escaped one byte over", "\u0001".repeat(Math.floor(exact.length / 6)) + "a".repeat(exact.length % 6 + 1), "seed", false],
      ]) {
        const receipt = await request(first, second);
        const context = config.path + " " + label;
        assert.equal(receipt.status, accepted ? 200 : 503, context);
        assert.ok(size(receipt) <= limit, context);
        assert.equal(receipt.headers.get("cache-control"), "private, no-store", context);
        assert.equal(receipt.stats.statements, config.statements, context);
        assert.equal(receipt.stats.writes, 0, context);
        if (accepted) {
          const expected = {
            ...baseline.body,
            results: baseline.body.results.map((r) => r.id === config.first
              ? { ...r, samples: [config.firstSample(first)] }
              : r.id === config.second ? { ...r, samples: [config.secondSample(second)] } : r),
          };
          assert.deepEqual(receipt.body, expected, context);
          if (label === "exact limit" || label === "escaped exact byte boundary") assert.equal(size(receipt), limit, context);
        } else {
          assert.deepEqual(receipt.body, { error: "unavailable" }, context);
          assert.doesNotMatch(receipt.text, /private-diagnostic-|seed-ref/);
        }
      }
      const idle = await call(config.path + config.idle, ADMIN, {
        d1: withSamples({ [config.first]: "a".repeat(70_000) }),
      });
      assert.equal(idle.status, 200, config.path + " idle");
      assert.deepEqual(idle.body.results, []);
      assert.equal(idle.stats.statements, 1);
      assert.equal(idle.stats.writes, 0);
      assert.equal(idle.headers.get("cache-control"), "private, no-store");
    }
  });

  test("MIG-0626 U05: selected staff preset diagnostics use bounded preset-specific reads", async () => {
    const { buildPermissionIntegrityChecks } = await import("@flamenode/server-core/admin/permissionIntegrityChecks");
    let jsonAccesses = 0;
    let queries = 0;
    let orderedQueries = 0;
    const customRows = [
      { id: "owner", event_id: "ev1", x_user_id: "owner-x", permission_preset: "owner",
        get custom_permission_keys_json() { throw new Error("owner JSON must not be accessed"); } },
      { id: "manager", event_id: "ev1", x_user_id: "manager-x", permission_preset: "manager",
        get custom_permission_keys_json() { throw new Error("manager JSON must not be accessed"); } },
      ...Array.from({ length: 498 }, (_, i) => ({
        id: "custom-" + i, event_id: "ev1", x_user_id: "custom-x-" + i, permission_preset: "custom",
        get custom_permission_keys_json() { jsonAccesses++; return "{not json"; },
      })),
    ];
    const db = {
      select(columns) {
        queries++;
        const boundedPresetQuery = Object.hasOwn(columns, "total_count");
        if (boundedPresetQuery) {
          assert.deepEqual(Object.keys(columns), ["id", "event_id", "x_user_id", "total_count"]);
          return { from: () => ({ where: () => ({
            orderBy: () => {
              orderedQueries++;
              return { limit: async (limit) => {
                assert.equal(limit, 50);
                return [{ id: "manager", event_id: "ev1", x_user_id: "manager-x", total_count: 1 }];
              } };
            },
          }) }) };
        }
        assert.deepEqual(Object.keys(columns), ["id", "event_id", "x_user_id", "permission_preset", "custom_permission_keys_json"]);
        return { from: () => ({ where: () => ({
          limit: async (limit) => {
            assert.equal(limit, 500, "custom parser input cap remains a documented S2 blocker");
            return customRows;
          },
        }) }) };
      },
    };
    const owner = await buildPermissionIntegrityChecks(db, "staff_owner_missing_permissions");
    assert.deepEqual(owner, []);
    assert.equal(queries, 0);
    const manager = await buildPermissionIntegrityChecks(db, "staff_manager_has_dangerous_permissions");
    assert.equal(manager.length, 1);
    assert.equal(manager[0].count, 1);
    assert.deepEqual(manager[0].issues, [{
      id: "manager", title: "@manager-x", description: "危険権限: video.permissions", adminHref: "/manage/events/ev1/staff",
    }]);
    assert.equal(jsonAccesses, 0);
    assert.equal(orderedQueries, 1);
    const custom = await buildPermissionIntegrityChecks(db, "staff_custom_json_invalid");
    assert.equal(custom.length, 1);
    assert.equal(custom[0].count, 498);
    assert.equal(custom[0].issues.length, 50);
    assert.equal(custom[0].moreCount, 448);
    assert.equal(jsonAccesses, 498, "custom rows still use the canonical JS parser");
    assert.equal(queries, 2);
  });

  test("MIG-0626 U05: preset SQL counts all matches and formats only 50 ordered samples", async () => {
    const { buildPermissionIntegrityChecks } = await import("@flamenode/server-core/admin/permissionIntegrityChecks");
    for (const preset of ["custom", "manager"]) {
      for (const total of [0, 1, 49, 50, 51, 500]) {
        let displayReads = 0;
        let jsonReads = 0;
        const visible = Math.min(total, 50);
        const returnedRows = preset === "custom" ? total : visible;
        const rows = Array.from({ length: returnedRows }, (_, i) => ({
          permission_preset: preset,
          total_count: total,
          get id() { displayReads++; return "id-" + i; },
          get event_id() { displayReads++; return "ev 1"; },
          get x_user_id() { displayReads++; return "x-" + i; },
          get custom_permission_keys_json() { jsonReads++; return "{not json"; },
        }));
        const db = {
          select(columns) {
            const boundedPresetQuery = Object.hasOwn(columns, "total_count");
            return { from: () => ({ where: () => ({
              orderBy: () => ({ limit: async (limit) => {
                assert.equal(limit, 50, preset + " " + total);
                return rows;
              } }),
              limit: async (limit) => {
                assert.equal(limit, 500, preset + " " + total);
                return rows;
              },
            }) }) };
          },
        };
        const checkId = preset === "custom" ? "staff_custom_json_invalid" : "staff_manager_has_dangerous_permissions";
        const result = await buildPermissionIntegrityChecks(db, checkId);
        assert.equal(displayReads, visible * 3, preset + " " + total);
        assert.equal(jsonReads, preset === "custom" ? total : 0);
        if (total === 0) {
          assert.deepEqual(result, []);
          continue;
        }
        assert.equal(result.length, 1);
        assert.equal(result[0].id, checkId);
        assert.equal(result[0].count, total);
        assert.equal(result[0].moreCount, total - visible);
        assert.deepEqual(result[0].issues, Array.from({ length: visible }, (_, i) => ({
          id: "id-" + i,
          title: "@x-" + i,
          description: preset === "custom" ? "JSON 不正 event:ev 1" : "危険権限: video.permissions",
          adminHref: "/manage/events/ev%201/staff",
        })));
      }
    }
  });

  test("MIG-0626 U05: selected custom diagnostics preserve the mixed CURRENT 500-row population", async () => {
    const { buildPermissionIntegrityChecks } = await import("@flamenode/server-core/admin/permissionIntegrityChecks");
    for (const [ownerCount, managerCount, customCount, expectedCustom] of [
      [499, 0, 5, 1],
      [500, 0, 5, 0],
      [0, 500, 5, 0],
      [0, 0, 5, 5],
    ]) {
      let jsonReads = 0;
      const nonCustom = (preset, prefix, count) => Array.from({ length: count }, (_, i) => ({
        id: prefix + i,
        event_id: "ev1",
        x_user_id: prefix + "x-" + i,
        permission_preset: preset,
        get custom_permission_keys_json() {
          throw new Error(preset + " JSON must not be accessed by the custom check");
        },
      }));
      const custom = Array.from({ length: customCount }, (_, i) => ({
        id: "custom-" + i,
        event_id: "ev1",
        x_user_id: "custom-x-" + i,
        permission_preset: "custom",
        get custom_permission_keys_json() {
          jsonReads++;
          return "{not json";
        },
      }));
      const rows = [
        ...nonCustom("owner", "owner-", ownerCount),
        ...nonCustom("manager", "manager-", managerCount),
        ...custom,
      ];
      let queries = 0;
      const db = {
        select(columns) {
          queries++;
          assert.deepEqual(Object.keys(columns), [
            "id", "event_id", "x_user_id", "permission_preset", "custom_permission_keys_json",
          ]);
          return { from: () => ({ where: () => ({ limit: async (limit) => {
            assert.equal(limit, 500);
            return rows.slice(0, limit);
          } }) }) };
        },
      };
      const result = await buildPermissionIntegrityChecks(db, "staff_custom_json_invalid");
      assert.equal(queries, 1);
      assert.equal(jsonReads, expectedCustom);
      if (expectedCustom === 0) {
        assert.deepEqual(result, []);
        continue;
      }
      assert.equal(result.length, 1);
      assert.equal(result[0].id, "staff_custom_json_invalid");
      assert.equal(result[0].count, expectedCustom);
      assert.equal(result[0].issues.length, expectedCustom);
      assert.equal(result[0].moreCount, 0);
    }
  });

  test("MIG-0626 U05: manager preset SQL returns a complete count and only 50 stable samples", async () => {
    const prefix = "mig0626-manager-bounded-";
    const ids = Array.from({ length: 120 }, (_, i) => prefix + String(i).padStart(3, "0"));
    const endpoint = "/api/admin-read/ops/integrity/staff_manager_has_dangerous_permissions";
    try {
      for (const [i, id] of ids.entries()) {
        ins("event_staff", {
          id, event_id: "ev1", x_user_id: prefix + "x-" + i, display_name: "synthetic manager",
          permission_preset: "manager", custom_permission_keys_json: null, created_at: T0, updated_at: T0,
        });
      }
      const expectedCount = Number(sqlite.prepare(
        "SELECT COUNT(*) AS count FROM event_staff WHERE permission_preset = 'manager'",
      ).all()[0].count);
      const expectedRows = sqlite.prepare(
        "SELECT id, event_id, x_user_id FROM event_staff WHERE permission_preset = 'manager' ORDER BY id LIMIT 50",
      ).all();
      const receipt = await call(endpoint, ADMIN);
      assert.equal(receipt.status, 200);
      assert.equal(receipt.headers.get("cache-control"), "private, no-store");
      assert.equal(receipt.stats.statements, 2, "session + one bounded D1 query");
      assert.equal(receipt.stats.writes, 0);
      const result = receipt.body.results[0];
      assert.equal(result.count, expectedCount);
      assert.equal(result.issues.length, 50);
      assert.equal(result.moreCount, expectedCount - 50);
      assert.deepEqual(result.issues, expectedRows.map((row) => ({
        id: row.id,
        title: "@" + (row.x_user_id || "—"),
        description: "危険権限: video.permissions",
        adminHref: "/manage/events/" + encodeURIComponent(row.event_id) + "/staff",
      })));
    } finally {
      for (const id of ids) sqlite.prepare("DELETE FROM event_staff WHERE id = ?").run(id);
    }
  });

  test("MIG-0626 U05: characterize staff permission diagnostic parsing and the remaining 500-row transfer gap", async () => {
    // Explicit characterization of CURRENT; 500 is NOT an accepted S2
    // limit or a complete database-wide integrity count.
    const prefix = "mig0626-staff-characterization-";
    const endpoint = "/api/admin-read/ops/integrity/";
    const add = (suffix, json, preset = "custom") => ins("event_staff", {
      id: prefix + suffix, event_id: "ev1", x_user_id: prefix + "x-" + suffix,
      display_name: "synthetic staff", permission_preset: preset,
      custom_permission_keys_json: json, created_at: T0, updated_at: T0,
    });
    const measure = async (check, token = ADMIN) => {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      const projections = [];
      d1.prepare = (sql) => {
        const wrap = (stmt) => {
          if (!/\bfrom\s+"?event_staff"?(?:\s|$)/i.test(sql)) return stmt;
          return {
            ...stmt,
            bind: (...args) => wrap(stmt.bind(...args)),
            async raw(options) {
              const rows = await stmt.raw(options);
              const data = options?.columnNames ? rows.slice(1) : rows;
              projections.push({ rows: data.length, bytes: Buffer.byteLength(JSON.stringify(data)) });
              return rows;
            },
            async all() {
              const result = await stmt.all();
              projections.push({ rows: result.results.length, bytes: Buffer.byteLength(JSON.stringify(result.results)) });
              return result;
            },
          };
        };
        return wrap(prepare(sql));
      };
      return { ...(await call(endpoint + check, token, { d1 })), projections };
    };
    const readOnly = (receipt, status = 200, statements = 2) => {
      assert.equal(receipt.status, status);
      assert.equal(receipt.headers.get("cache-control"), "private, no-store");
      assert.equal(receipt.stats.statements, statements);
      assert.equal(receipt.stats.writes, 0);
      assert.ok(Buffer.byteLength(receipt.text) <= 64 * 1024);
    };
    const invalid = "staff_custom_json_invalid";
    const issue = (suffix) => ({
      id: prefix + suffix,
      title: "@" + prefix + "x-" + suffix,
      description: "JSON 不正 event:ev1",
      adminHref: "/manage/events/ev1/staff",
    });
    const result = (count, issues) => ({
      id: invalid, title: "custom JSON がパース不能", area: "event_staff",
      severity: "warning", description: "custom_permission_keys_json が壊れています。",
      count, issues, moreCount: count - issues.length,
      recommendation: "JSON を修正してください。",
    });
    const deepNestedNonString = "[".repeat(1000) + "0" + "]".repeat(1000);
    const cases = [
      ["null", null, false],
      ["empty", "", false],
      ["empty-array", "[]", false],
      ["trimmed-empty", "\u00a0[]\u00a0", false],
      ["bom-empty", "\uFEFF[]\uFEFF", false],
      ["deep-nested-only", deepNestedNonString, true],
      ["deep-nested-valid-alias", `["videos.title",${deepNestedNonString}]`, false],
      ["spaced-array", " [ ] ", true],
      ["whitespace-only", " \t\n ", true],
      ["malformed", "{not json", true],
      ["non-array", '{"key":"event.basic"}', true],
      ["non-strings", "[null,7,true,{}]", true],
      ["unknown-only", '["bogus.key"]', true],
      ["known", '["event.basic"]', false],
      ["legacy-alias", '["videos.title"]', false],
      ["admin-only-key", '["xid.link_requests"]', false],
      ["mixed", '["bogus.key",7,"event.basic"]', false],
      ["duplicate", '["event.basic","event.basic"]', false],
      ["escaped-key", '["\\u0065vent.basic"]', false],
      ["wrong-case", '["EVENT.BASIC"]', true],
      ["trailing-space-key", '["event.basic "]', true],
      ["nul-key", '["event.basic\\u0000"]', true],
      ["json-trailing-comma", '["event.basic",]', true],
    ];
    // Do not disturb the shared seed for the other parity checks.
    sqlite.exec("SAVEPOINT mig0626_staff_characterization");
    try {
      sqlite.exec("UPDATE event_staff SET permission_preset = 'public_staff'");
      const empty = await measure(invalid);
      readOnly(empty);
      assert.deepEqual(empty.body, { ran: true, results: [] });
      assert.deepEqual(empty.projections.map((p) => p.rows), [0]);

      for (const [suffix, json] of cases) add(suffix, json);
      add("owner", "{not json", "owner");
      add("manager", "{not json", "manager");
      add("excluded", "{not json", "public_staff");
      const corpus = await measure(invalid);
      readOnly(corpus);
      const expectedIssues = cases.filter(([, , bad]) => bad).map(([suffix]) => issue(suffix));
      assert.deepEqual(corpus.projections.map((p) => p.rows), [cases.length + 2]);
      assert.equal(corpus.body.results.length, 1);
      const sortIssues = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
      const received = corpus.body.results[0];
      assert.deepEqual({ ...received, issues: sortIssues(received.issues) },
        result(expectedIssues.length, sortIssues(expectedIssues)));
      assert.doesNotMatch(corpus.text, /bogus\.key|not json/);
      const owner = await measure("staff_owner_missing_permissions");
      // The canonical owner preset resolves all its own keys. The selected
      // check must not touch event_staff when there are no missing keys.
      readOnly(owner, 200, 1);
      assert.deepEqual(owner.projections, []);
      assert.deepEqual(owner.body, { ran: true, results: [] });
      const manager = await measure("staff_manager_has_dangerous_permissions");
      readOnly(manager);
      assert.deepEqual(manager.projections.map((p) => p.rows), [1]);
      assert.equal(manager.body.results[0].count, 1);
      assert.deepEqual(manager.body.results[0].issues, [{
        ...issue("manager"), description: "危険権限: video.permissions",
      }]);

      sqlite.exec("UPDATE event_staff SET permission_preset = 'public_staff'");
      // A small/empty HTTP receipt does not prove bounded D1 input or parse CPU.
      const huge = JSON.stringify(["event.basic", "z".repeat(70_000)]);
      add("large-valid", huge);
      const large = await measure(invalid);
      readOnly(large);
      assert.deepEqual(large.body, { ran: true, results: [] });
      assert.deepEqual(large.projections.map((p) => p.rows), [1]);
      assert.ok(large.projections[0].bytes > 64 * 1024);

      sqlite.exec("UPDATE event_staff SET permission_preset = 'public_staff'");
      // All 620 rows are invalid, so this demonstrates an incomplete count
      // independently of the existing SELECT's unspecified row order.
      const allIds = Array.from({ length: 620 }, (_, i) => "bulk-" + i);
      for (const suffix of allIds) add(suffix, "{not json");
      const fullInvalid = sqlite.prepare(
        "SELECT COUNT(*) AS n FROM event_staff WHERE permission_preset = 'custom'"
      ).get().n;
      assert.equal(fullInvalid, 620);
      const bulk = await measure(invalid);
      readOnly(bulk);
      assert.deepEqual(bulk.projections.map((p) => p.rows), [500]);
      assert.equal(bulk.body.results.length, 1);
      const observed = bulk.body.results[0];
      assert.equal(observed.count, 500, "CURRENT incomplete count; update when full scan/snapshot contract is approved");
      assert.equal(observed.moreCount, 450);
      assert.equal(observed.issues.length, 50);
      assert.equal(new Set(observed.issues.map((r) => r.id)).size, 50);
      const allowed = new Set(allIds.map((suffix) => JSON.stringify(issue(suffix))));
      assert.ok(observed.issues.every((row) => allowed.has(JSON.stringify(row))));
      assert.ok(observed.count < fullInvalid, "characterization of known gap, NOT acceptance");
      const denied = await measure(invalid, "tok-alice");
      readOnly(denied, 403, 1);
      assert.deepEqual(denied.projections, []);
    } finally {
      sqlite.exec("ROLLBACK TO mig0626_staff_characterization; RELEASE mig0626_staff_characterization");
    }
  });

  test("MIG-0626 U05: integrity diagnosis bounds the full UTF-8 response and preserves in-budget issues", async () => {
    const { runIntegrityCheckById } = await import("@flamenode/server-core/admin/integrityChecks");
    const checkId = "audit_videos_orphan";
    const path = "/api/admin-read/ops/integrity/" + checkId;
    const ids = Array.from({ length: 5 }, (_, i) => "integrity-byte-bound-" + i);
    const seedTarget = "integrity-missing-target";
    const limit = 64 * 1024;
    const encoder = new TextEncoder();
    const size = (receipt) => encoder.encode(receipt.text).length;
    const update = sqlite.prepare("UPDATE audit_logs SET target_id = ? WHERE id = ?");
    try {
      for (const id of ids) {
        ins("audit_logs", {
          id, table_name: "videos", target_id: seedTarget,
          operation: "UPDATE", actor_user_id: "u_carol", created_at: T0,
        });
      }
      const baseline = await call(path, ADMIN);
      assert.equal(baseline.status, 200);
      assert.ok(ids.every((id) => baseline.body.results[0].issues.some((issue) => issue.id === id)),
        "all five fixture issues must be present before testing byte limits");
      const exact = "a".repeat(limit - size(baseline) + seedTarget.length);
      for (const [label, values, accepted] of [
        ["exact limit", [exact], true],
        ["one byte over", [exact + "a"], false],
        ["oversized ASCII", ["private-integrity-" + "a".repeat(70_000)], false],
        ["multibyte", ["private-integrity-" + "あ".repeat(22_000)], false],
        ["escaped controls", ["private-integrity-" + "\u0001".repeat(11_000)], false],
        ["aggregate five issues", ids.map(() => "private-integrity-" + "あ".repeat(4_500)), false],
        ["valid multibyte", ["あ".repeat(10_000)], true],
      ]) {
        for (let i = 0; i < ids.length; i++) update.run(values[i] ?? seedTarget, ids[i]);
        const receipt = await call(path, ADMIN);
        assert.equal(receipt.status, accepted ? 200 : 503, label);
        assert.ok(size(receipt) <= limit, label);
        assert.equal(receipt.headers.get("cache-control"), "private, no-store", label);
        assert.equal(receipt.stats.statements, 2, label + ": session + one selected check");
        assert.equal(receipt.stats.writes, 0, label);
        if (accepted) {
          const expected = await runIntegrityCheckById(refDb, checkId);
          assert.deepEqual(receipt.body, canon({ ran: true, results: [expected] }), label);
          assert.equal(receipt.body.results[0].count, baseline.body.results[0].count, label);
          assert.equal(receipt.body.results[0].moreCount, baseline.body.results[0].moreCount, label);
          if (label === "exact limit") assert.equal(size(receipt), limit);
        } else {
          assert.deepEqual(receipt.body, { error: "unavailable" }, label);
          assert.doesNotMatch(receipt.text, /private-integrity-|integrity-byte-bound-/);
        }
      }
    } finally {
      for (const id of ids) sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run(id);
    }
  });

  test("T02 cost guard equals CURRENT (mode resolution, exception window, last 20 system_settings updates); no row -> defaults", async () => {
    sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
    assert.deepEqual((await get("/ops/cost-guard")).body, await refCostGuard());
    assert.equal((await get("/ops/cost-guard")).body.mode, "normal");
    ins("system_settings", { id: "default", operation_mode: "maintenance", cost_guard_reason: "spike", cost_guard_updated_at: T0 + 5, cost_guard_exception_until: T0 + 900, cost_guard_exception_features_json: "[\"video_submit\"]", disabled_features_json: "[\"x\"]" });
    for (let i = 0; i < 25; i += 1) {
      ins("audit_logs", { id: `cg${i}`, table_name: "system_settings", target_id: "default", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 3000 + i, before_json: JSON.stringify({ operation_mode: "normal" }), after_json: JSON.stringify({ operation_mode: "maintenance" }) });
    }
    const r = await get("/ops/cost-guard");
    assert.deepEqual(r.body, await refCostGuard());
    assert.equal(r.body.mode, "maintenance");
    assert.equal(r.body.isMaintenance, true);
    assert.equal(r.body.history.length, 20);
    sqlite.exec("UPDATE system_settings SET operation_mode = 'not-a-mode' WHERE id = 'default'");
    assert.deepEqual((await get("/ops/cost-guard")).body, await refCostGuard(), "unknown mode falls back to normal");
  });

  test("MIG-0626: cost guard bounds settings and history together without false normal state", async () => {
    const endpoint = "/api/admin-read/ops/cost-guard";
    const limit = 64 * 1024;
    const size = (value) => Buffer.byteLength(JSON.stringify(value));
    const read = () => call(endpoint, ADMIN);
    const update = sqlite.prepare(
      "UPDATE system_settings SET cost_guard_reason = ?, cost_guard_exception_features_json = ?, disabled_features_json = ? WHERE id = 'default'"
    );
    const check = (receipt, status, statements) => {
      assert.equal(receipt.status, status);
      assert.equal(receipt.headers.get("cache-control"), "private, no-store");
      assert.equal(receipt.stats.statements, statements);
      assert.equal(receipt.stats.writes, 0);
      assert.ok(Buffer.byteLength(receipt.text) <= limit);
      if (status === 503) {
        assert.deepEqual(receipt.body, { error: "unavailable" });
        assert.doesNotMatch(receipt.text, /private-cost-guard/);
      }
    };
    sqlite.exec("SAVEPOINT mig0626_cost_guard_envelope");
    try {
      sqlite.exec("DELETE FROM audit_logs WHERE table_name = 'system_settings' AND operation = 'UPDATE'");
      sqlite.exec("UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'");
      update.run("seed", "[]", "[]");
      const base = await read();
      check(base, 200, 3);
      assert.equal(base.body.mode, "maintenance");
      assert.equal(base.body.isMaintenance, true);
      assert.deepEqual(base.body.history, []);
      const exact = "a".repeat(limit - size(base.body) + "seed".length);
      for (const [reason, exception, disabled, accepted] of [
        [exact, "[]", "[]", true],
        [exact + "a", "[]", "[]", false],
        ["private-cost-guard-" + "a".repeat(70_000), "[]", "[]", false],
        ["private-cost-guard-" + "あ".repeat(22_000), "[]", "[]", false],
        ["private-cost-guard-" + "\u0001".repeat(11_000), "[]", "[]", false],
        ["seed", JSON.stringify(["あ".repeat(11_000)]), JSON.stringify(["あ".repeat(11_000)]), false],
        ["あ".repeat(10_000), "[]", "[]", true],
      ]) {
        update.run(reason, exception, disabled);
        const r = await read();
        check(r, accepted ? 200 : 503, accepted ? 3 : 2);
        if (accepted) {
          assert.deepEqual(r.body, { ...base.body, reason, exceptionFeaturesJson: exception, disabledFeaturesJson: disabled });
          if (reason === exact) assert.equal(Buffer.byteLength(r.text), limit);
        }
      }
      update.run("seed", "[]", "[]");
      for (let i = 0; i < 3; i++) {
        ins("audit_logs", {
          id: "mig0626-cost-envelope-" + i, table_name: "system_settings", target_id: "default",
          operation: "UPDATE", actor_user_id: "u_carol", created_at: 4_000_000_000 + i,
          before_json: JSON.stringify({ text: "あ".repeat(4000) }), after_json: "{}",
        });
      }
      const full = await read();
      check(full, 200, 3);
      assert.equal(full.body.history.length, 3);
      assert.equal(full.body.truncated, false);
      const two = { ...full.body, history: full.body.history.slice(0, 2) };
      const twoReason = "a".repeat(limit - size(two) + "seed".length);
      update.run(twoReason, "[]", "[]");
      const clipped = await read();
      check(clipped, 200, 3);
      assert.deepEqual(clipped.body, { ...two, reason: twoReason, truncated: true });
      assert.equal(Buffer.byteLength(clipped.text), limit - 1);
      update.run(twoReason + "a", "[]", "[]");
      const one = await read();
      check(one, 200, 3);
      assert.deepEqual(one.body, { ...two, reason: twoReason + "a", history: two.history.slice(0, 1), truncated: true });
      update.run("seed", "[]", "[]");
      ins("audit_logs", {
        id: "mig0626-cost-envelope-oversize", table_name: "system_settings", target_id: "default",
        operation: "UPDATE", actor_user_id: "u_carol", created_at: 4_000_000_010,
        before_json: "private-cost-guard-" + "z".repeat(70_000), after_json: "{}",
      });
      const oversizeRow = await read();
      check(oversizeRow, 200, 3);
      assert.deepEqual(oversizeRow.body, { ...base.body, truncated: true });
      assert.doesNotMatch(oversizeRow.text, /private-cost-guard/);
      check(await call(endpoint, "tok-alice"), 403, 1);
    } finally {
      sqlite.exec("ROLLBACK TO mig0626_cost_guard_envelope; RELEASE mig0626_cost_guard_envelope");
    }
  });

  test("T05 cost guard: a failing read renders CURRENT's defaults (200), without internals", async () => {
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/FROM system_settings/.test(text)) throw new Error("secret-internal");
      return prepare(text);
    };
    const r = await call("/api/admin-read/ops/cost-guard", ADMIN, { d1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, "normal");
    assert.deepEqual(r.body.history, []);
    assert.doesNotMatch(r.text, /secret-internal/);
  });

  test("T02 youtube sync equals CURRENT for every filter (left join, stale/missing, visibility groups, hasMore)", async () => {
    for (const sp of [
      {}, { sync_status: "failed" }, { sync_status: "pending" }, { sync_status: "bogus" }, { privacy: "private" }, { availability: "unavailable" },
      { visibility: "review" }, { visibility: "public" }, { visibility: "closed" }, { visibility: "pending" }, { visibility: "bogus" }, { visibility: "all" },
      { failed: "1" }, { stale: "1" }, { missing: "1" }, { stale: "1", missing: "1", visibility: "private" },
    ]) {
      const query = new URLSearchParams(sp).toString();
      const r = await get(`/ops/youtube-sync${query ? `?${query}` : ""}`);
      assert.deepEqual(r.body, await refYoutubeSync(sp), JSON.stringify(sp));
    }
    assert.equal((await get("/ops/youtube-sync?missing=1")).body.rows.length, 2);
  });

  // ---------------- S2 byte budget for the ops lists (UTF-8 bytes, first row included) ----------------
  const OPS_BYTE_CASES = [
    {
      name: "notifications", path: "/ops/notifications", rowsKey: "rows",
      seed: (id, text, at) => notif(id, "video_bulk", "sent", { at, error: text }),
      clean: () => sqlite.exec("DELETE FROM notification_outbox WHERE id LIKE 'bb-%'"),
    },
    {
      name: "static-builds", path: "/ops/static-builds", rowsKey: "rows",
      env: { KV: { async get() { return null; } }, BUCKET: { async head() { return null; } } },
      seed: (id, text, at) => ins("static_rebuild_queue", { id, target_type: "video", target_id: id, status: "failed", priority: "normal", attempt_count: 1, created_at: at, updated_at: at, error: text }),
      clean: () => sqlite.exec("DELETE FROM static_rebuild_queue WHERE id LIKE 'bb-%'"),
    },
    {
      name: "cost-guard history", path: "/ops/cost-guard", rowsKey: "history",
      seed: (id, text, at) => ins("audit_logs", { id, table_name: "system_settings", target_id: "default", operation: "UPDATE", actor_user_id: "u_carol", created_at: at, before_json: text, after_json: "{}" }),
      clean: () => sqlite.exec("DELETE FROM audit_logs WHERE id LIKE 'bb-%'"),
    },
    {
      name: "youtube-sync", path: "/ops/youtube-sync", rowsKey: "rows",
      seed: (id, text, at) => {
        ins("videos", { id, title: id, submitted_by_user_id: "u_zed_user", creator_display_name: "n", youtube_video_id: "yt-" + id, visibility_status: "public", created_at: at });
        ytMeta(id, { status: "failed", error: text, synced: nowS, updated: at });
      },
      clean: () => { sqlite.exec("DELETE FROM video_youtube_metadata WHERE video_id LIKE 'bb-%'"); sqlite.exec("DELETE FROM videos WHERE id LIKE 'bb-%'"); },
    },
  ];
  for (const c of OPS_BYTE_CASES) {
    test(`S2 byte budget: ${c.name} counts UTF-8 bytes and bounds the first row too`, async () => {
      const fetchList = async () => {
        const r = await call(`/api/admin-read${c.path}`, ADMIN, c.env ? { env: c.env } : {});
        assert.equal(r.status, 200, r.text.slice(0, 200));
        assert.ok(new TextEncoder().encode(r.text).length < 64 * 1024, "response < 64 KiB bytes");
        return r.body;
      };
      const FAR = 4_000_000_000;
      // 20,000 chars = 60,000 UTF-8 bytes: an over-budget FIRST row is dropped, not returned.
      c.seed("bb-wide", "あ".repeat(20_000), FAR);
      const wide = await fetchList();
      assert.equal(wide.truncated, true);
      assert.deepEqual(wide[c.rowsKey].filter((r) => JSON.stringify(r).includes("bb-wide")), []);
      assert.equal(wide[c.rowsKey].length, 0, "newest row over the budget -> nothing kept");
      c.clean();
      // 4,200 chars = 12,600 bytes (4,200 UTF-16 units): only 3 fit in 48 KiB; UTF-16 counting would keep ~11.
      for (let i = 0; i < 6; i += 1) c.seed(`bb-mid${i}`, "あ".repeat(4_200), FAR + i);
      const mid = await fetchList();
      assert.equal(mid.truncated, true);
      assert.equal(mid[c.rowsKey].length, 3);
      c.clean();
    });
  }
}

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
  const { and, asc, desc, eq, gte, inArray, isNull, like, lte, lt, or, sql } = await import("drizzle-orm");
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
      refDb.select({ id: S.auditLogs.id, created_at: S.auditLogs.created_at }).from(S.auditLogs).where(and(eq(S.auditLogs.target_id, row.target_id), lt(S.auditLogs.created_at, row.created_at))).orderBy(desc(S.auditLogs.created_at)).limit(1),
      refDb.select({ id: S.auditLogs.id, created_at: S.auditLogs.created_at }).from(S.auditLogs).where(and(eq(S.auditLogs.target_id, row.target_id), sql`${S.auditLogs.created_at} > ${row.created_at}`)).orderBy(asc(S.auditLogs.created_at)).limit(1),
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
    for (const raw of [undefined, "20000", "50", "abc", "10000001"]) {
      assert.deepEqual(await fetchQuota({ YOUTUBE_DAILY_QUOTA_LIMIT: raw }), await refQuota(raw), String(raw));
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

  test("T02 health (operational view) equals CURRENT runOperationalHealthChecks; deep run is 501", async () => {
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

    const deep = await call("/api/admin-read/ops/health?deep=1", ADMIN);
    assert.equal(deep.status, 501);
    assert.equal(deep.headers.get("cache-control"), "private, no-store");
    assert.equal(deep.stats.statements, 1, "no health query for a deep run");
    assert.equal((await call("/api/admin-read/ops/health?run=1", ADMIN)).status, 501);

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

  test("T02 integrity: idle state like CURRENT (no query); run=1 is the recorded STOP (501)", async () => {
    const idle = await get("/ops/integrity");
    assert.deepEqual(idle.body, { ran: false, results: [] });
    assert.equal(idle.stats.statements, 1, "no page query without run=1");
    const run = await call("/api/admin-read/ops/integrity?run=1", ADMIN);
    assert.equal(run.status, 501);
    assert.equal(run.headers.get("cache-control"), "private, no-store");
    assert.equal(run.stats.statements, 1);
    assert.equal((await call("/api/admin-read/ops/integrity", "tok-alice")).status, 403);
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

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
  const { queryEventGroupEventOptions } = await import("../../../src/lib/admin/eventGroupEventOptions.ts");
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
    const rows = statement.all(...params).map((row) => Object.values(row));
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
    const response = await app.request(path, { method: options.method ?? "GET", headers: token ? cookie(token) : {} }, { DB: d1 });
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

  async function refEventGroups(sp) {
    const GROUP_TYPE_LABELS = { series: 1, genre: 1, related: 1, collection: 1, other: 1 };
    const visibilityFilter = sp.visibility === "public" || sp.visibility === "private" || sp.visibility === "archived" ? sp.visibility : "any";
    const typeFilter = sp.type && sp.type in GROUP_TYPE_LABELS ? sp.type : "any";
    const conds = [
      visibilityFilter !== "any" ? eq(S.eventGroups.visibility_status, visibilityFilter) : undefined,
      typeFilter !== "any" ? eq(S.eventGroups.group_type, typeFilter) : undefined,
    ].filter((c) => c !== undefined);
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
    const rows = await refDb
      .select({
        id: S.eventGroups.id, name: S.eventGroups.name, slug: S.eventGroups.slug, group_type: S.eventGroups.group_type,
        visibility_status: S.eventGroups.visibility_status, sort_order: S.eventGroups.sort_order,
        event_count: sql`count(${S.eventGroupEvents.event_id})`.as("event_count"),
      })
      .from(S.eventGroups)
      .leftJoin(S.eventGroupEvents, eq(S.eventGroupEvents.event_group_id, S.eventGroups.id))
      .where(where)
      .groupBy(S.eventGroups.id)
      .orderBy(asc(S.eventGroups.sort_order), asc(S.eventGroups.name))
      .limit(100);
    return canon({ visibility: visibilityFilter, type: typeFilter, items: rows.map((r) => ({ ...r, event_count: Number(r.event_count) })) });
  }

  async function refEventGroup(id) {
    const row = (await refDb.select().from(S.eventGroups).where(eq(S.eventGroups.id, id)).limit(1))[0];
    if (!row) return null;
    const [members, eventOptions] = await Promise.all([
      refDb
        .select({ event_id: S.eventGroupEvents.event_id, title: S.events.title, start_time: S.events.start_time })
        .from(S.eventGroupEvents)
        .innerJoin(S.events, eq(S.events.id, S.eventGroupEvents.event_id))
        .where(eq(S.eventGroupEvents.event_group_id, id))
        .orderBy(desc(S.events.start_time), asc(S.events.id)),
      queryEventGroupEventOptions(refDb, { groupId: id, query: "", cursor: null }),
    ]);
    return canon({
      group: pick(row, ["id", "updated_at", "name", "slug", "description", "group_type", "icon_url", "accent_color", "visibility_status", "sort_order"]),
      members,
      eventOptions,
    });
  }

  async function refTemplates(templateId) {
    const items = await refDb
      .select({ id: S.eventTemplates.id, name: S.eventTemplates.name, description: S.eventTemplates.description, source_event_id: S.eventTemplates.source_event_id, updated_at: S.eventTemplates.updated_at })
      .from(S.eventTemplates)
      .orderBy(desc(S.eventTemplates.updated_at));
    let selected = null;
    if (templateId) {
      const row = (await refDb.select().from(S.eventTemplates).where(eq(S.eventTemplates.id, templateId)).limit(1))[0];
      if (row) selected = { id: row.id, name: row.name, settings_json: row.settings_json };
    }
    return canon({ items, selected });
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
    return canon({ limit, truncated: false, rows, operators });
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

  // ---------------- T03 authz ----------------
  const ENDPOINTS = [
    "/announcements", "/announcements/ann-01", "/rules", "/rules/T2", "/event-groups", "/event-groups/g1", "/event-templates",
    "/audit-settings", "/audit", "/audit/a1", "/audit/restore", "/ops/notifications", "/ops/youtube-sync", "/ops/cost-guard",
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
      ["/event-groups", /event_groups/],
      ["/audit", /FROM audit_logs/],
      ["/audit/restore", /audit_restore_runs/],
      ["/event-templates", /event_templates/],
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

  // ---------------- event groups ----------------
  test("T02 event groups list equals CURRENT for every filter (member counts, order, limit)", async () => {
    for (const sp of [{}, { visibility: "public" }, { type: "series" }, { visibility: "private", type: "genre" }, { type: "constructor" }, { type: "bogus" }]) {
      const query = new URLSearchParams(sp).toString();
      const r = await get(`/event-groups${query ? `?${query}` : ""}`);
      assert.deepEqual(r.body, await refEventGroups(sp), JSON.stringify(sp));
    }
    const all = (await get("/event-groups")).body.items;
    assert.deepEqual(all.map((g) => [g.id, g.event_count]), [["g2", 1], ["g3", 1], ["g1", 4], ["g4", 0]]);
  });

  test("T02 event group detail equals CURRENT (members by start_time desc / id, add-event options); empty group; missing -> 404", async () => {
    for (const id of ["g1", "g2", "g4"]) {
      assert.deepEqual((await get(`/event-groups/${id}`)).body, await refEventGroup(id), id);
    }
    const g1 = (await get("/event-groups/g1")).body;
    assert.deepEqual(g1.members.map((m) => m.event_id), ["ev3", "ev4", "ev5", "ev2"], "NULL start_time last");
    assert.equal((await get("/event-groups/g4")).body.members.length, 0);
    assert.equal((await call("/api/admin-read/event-groups/nope", ADMIN)).status, 404);
  });

  test("T02 event group add-event options page at 80 with the CURRENT cursor", async () => {
    for (let i = 0; i < 90; i += 1) ins("events", { id: `evx${String(i).padStart(2, "0")}`, title: `X ${i}`, start_time: i, updated_at: T0 + 1000 + i });
    const r = await get("/event-groups/g4");
    assert.deepEqual(r.body, await refEventGroup("g4"));
    assert.equal(r.body.eventOptions.options.length, 80);
    assert.ok(r.body.eventOptions.nextCursor);
  });

  // ---------------- event templates / audit settings ----------------
  test("T02 event templates list (+ ?template= selection) equals CURRENT", async () => {
    assert.deepEqual((await get("/event-templates")).body, await refTemplates(null));
    assert.deepEqual((await get("/event-templates?template=tpl-1")).body, await refTemplates("tpl-1"));
    assert.deepEqual((await get("/event-templates?template=nope")).body, await refTemplates("nope"));
    assert.deepEqual((await get("/event-templates?template=%20tpl-2%20")).body, await refTemplates("tpl-2"));
  });

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
    assert.match(r.body.rows[0].after_json, /REDACTED/);
  });

  test("S2 budget: audit list truncates to the 64 KiB response budget instead of growing", async () => {
    const big = "x".repeat(30_000);
    for (let i = 0; i < 8; i += 1) {
      ins("audit_logs", { id: `a-big${i}`, table_name: "big", target_id: "b1", operation: "UPDATE", actor_user_id: "u_carol", created_at: T0 + 2000 + i, before_json: big, after_json: big });
    }
    const r = await get("/audit?table=big");
    assert.equal(r.body.truncated, true);
    assert.ok(r.body.rows.length >= 1 && r.body.rows.length < 8);
    assert.equal(r.body.rows[0].id, "a-big7", "newest rows are kept");
  });

  test("T02 audit detail equals CURRENT (prev/next on the same target); missing -> 404", async () => {
    for (const id of ["a1", "a2", "a5", "a3", "a7"]) {
      assert.deepEqual((await get(`/audit/${id}`)).body, await refAuditDetail(id), id);
    }
    const a2 = (await get("/audit/a2")).body;
    assert.equal(a2.prev.id, "a1");
    assert.equal(a2.next.id, "a5");
    assert.equal((await call("/api/admin-read/audit/nope", ADMIN)).status, 404);
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
}

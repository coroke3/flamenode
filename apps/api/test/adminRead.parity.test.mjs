import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/adminReadSeed.mjs";

// MIG-0625 parity: the same seed is read by CURRENT's admin loaders (the real src/** functions plus the drizzle
// queries copied verbatim from app/(admin)/admin/**/page.tsx, which are not importable) and by /api/admin-read/*.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { and, desc, eq, inArray, isNotNull, isNull, like, or, sql, asc } = await import("drizzle-orm");
  const S = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const { clampPaging, escapeLike } = await import("../../../src/lib/utils/sql.ts");
  const { normalizeXId } = await import("../../../src/lib/utils/xid.ts");
  const { loadAdminXUserEnrichment } = await import("../../../src/lib/admin/adminXUserEnrichment.ts");
  const { getLatestPublishedMajorTerms, termsReacceptRequiredValue } = await import("../../../src/lib/terms/reaccept.ts");
  const { getLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/xIdentity.ts");
  const { enrichXLinkPendingRows } = await import("../../../src/lib/admin/enrichXLinkPendingRows.ts");
  const { resolveManageXIconUrl } = await import("../../../src/lib/media/manageXIcon.ts");
  const { parseAuditDiff } = await import("../../../src/lib/audit/diff.ts");
  const { acceptingEntriesWhere } = await import("../../../src/lib/utils/eventStatus.ts");
  const { videoReviewQueueOrder } = await import("../../../src/lib/admin/videoReviewQueueOrder.ts");
  const { normalizeVideoVisibilityFilter, videoVisibilityStatusesForFilter } = await import(
    "../../../src/lib/admin/videoVisibilityLabels.ts"
  );

  const sqlite = createSqlite();
  seed(sqlite);
  const refDb = drizzle(async (text, params, method) => {
    const statement = sqlite.prepare(text);
    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }
    const rows = statement.all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });

  const SECRET = "test-secret-mig-0625";
  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));

  const parseBody = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  async function call(path, token, options = {}) {
    const d1 = options.d1 ?? createD1(sqlite);
    const response = await app.request(path, { method: options.method ?? "GET", headers: token ? cookie(token) : {} }, { DB: d1, AUTH_SECRET: options.secret === undefined ? SECRET : options.secret });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? parseBody(text) : null, stats: d1.stats };
  }
  const get = async (path, token = "root") => {
    const r = await call(path, `tok-${token}`);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.equal(r.stats.writes, 0, `${path}: GET must not write`);
    assert.ok(r.stats.maxBinds <= 100, `${path}: ${r.stats.maxBinds} binds`);
    assert.ok(r.stats.statements <= 3, `${path}: ${r.stats.statements} D1 statements (S2 allows 3 incl. session)`);
    assert.equal(r.stats.batches, 0);
    return r;
  };

  // ---------- CURRENT reference loaders (queries copied from the pages) ----------
  async function refModeration({ type, status, overdue }) {
    const CASE_TYPES = ["x_reapply", "void", "duplicate", "rights", "operator"];
    const CASE_STATUSES = ["open", "resolved", "rejected", "expired", "cancelled"];
    const typeFilter = CASE_TYPES.includes(type) ? type : "all";
    const statusFilter = CASE_STATUSES.includes(status) ? status : "open";
    const now = Math.floor(Date.now() / 1000);
    const conds = [];
    if (typeFilter !== "all") conds.push(eq(S.videoModerationCases.case_type, typeFilter));
    if (statusFilter !== "all") conds.push(eq(S.videoModerationCases.status, statusFilter));
    if (overdue === "1") conds.push(sql`${S.videoModerationCases.due_at} < ${now}`);
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
    const query = refDb
      .select({
        id: S.videoModerationCases.id, video_id: S.videoModerationCases.video_id, case_type: S.videoModerationCases.case_type,
        status: S.videoModerationCases.status, public_reason: S.videoModerationCases.public_reason,
        private_note: S.videoModerationCases.private_note, due_at: S.videoModerationCases.due_at,
        locked_until: S.videoModerationCases.locked_until, attempt_count: S.videoModerationCases.attempt_count,
        related_x_user_id: S.videoModerationCases.related_x_user_id, created_by_user_id: S.videoModerationCases.created_by_user_id,
        resolved_by_user_id: S.videoModerationCases.resolved_by_user_id, created_at: S.videoModerationCases.created_at,
        resolved_at: S.videoModerationCases.resolved_at, video_title: S.videos.title, video_status: S.videos.visibility_status,
        related_x_name: S.xUsers.x_name,
      })
      .from(S.videoModerationCases)
      .leftJoin(S.videos, eq(S.videos.id, S.videoModerationCases.video_id))
      .leftJoin(S.xUsers, eq(S.xUsers.id, S.videoModerationCases.related_x_user_id));
    return (where ? query.where(where) : query).orderBy(desc(S.videoModerationCases.created_at)).limit(100);
  }

  async function refEvents({ sort: sortRaw, filter: filterRaw, q: qRaw }, now) {
    const sort = sortRaw === "oldest" || sortRaw === "upcoming" ? sortRaw : "newest";
    const filter = ["public", "private", "accepting"].includes(filterRaw) ? filterRaw : "all";
    const q = (qRaw ?? "").trim();
    const term = `%${q}%`;
    const conds = [
      filter === "public" || filter === "private" ? eq(S.events.visibility_status, filter) : undefined,
      q ? or(like(S.events.title, term), like(S.events.id, term)) : undefined,
      filter === "accepting" ? acceptingEntriesWhere(now) : undefined,
    ].filter((c) => c !== undefined);
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
    const order = sort === "oldest" || sort === "upcoming" ? asc(S.events.start_time) : desc(S.events.start_time);
    const base = refDb.select().from(S.events);
    const rows = where ? await base.where(where).orderBy(order).limit(60) : await base.orderBy(order).limit(60);
    return rows.map((r) => ({
      id: r.id, title: r.title, visibility_status: r.visibility_status, start_time: r.start_time, end_time: r.end_time,
      entry_start_time: r.entry_start_time, entry_end_time: r.entry_end_time,
    }));
  }

  async function refVideos({ q: qRaw, status: statusRaw, event: eventRaw, page: pageRaw }) {
    const q = qRaw ?? "";
    const status = normalizeVideoVisibilityFilter(statusRaw);
    const event = eventRaw ?? "";
    const { pageSize, offset } = clampPaging({ page: pageRaw || "1", pageSize: 50, defaultPageSize: 50, maxPageSize: 50 });
    const term = `%${escapeLike(q)}%`;
    const queryFilter = q
      ? or(like(S.videos.title, term), like(S.videos.creator_display_name, term), like(S.videos.creator_x_user_id, term), like(S.xUsers.x_name, term), like(S.xUsers.id, term))
      : undefined;
    const statusValues = videoVisibilityStatusesForFilter(status);
    const statusFilter = statusValues && statusValues.length > 1 ? inArray(S.videos.visibility_status, statusValues) : statusValues?.[0] ? eq(S.videos.visibility_status, statusValues[0]) : undefined;
    const eventFilter = event ? eq(S.videoEvents.event_id, event) : undefined;
    const conds = [queryFilter, statusFilter, eventFilter].filter((c) => c !== undefined);
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
    const base = refDb
      .select({ id: S.videos.id, title: S.videos.title, source_type: S.videos.source_type, youtube_video_id: S.videos.youtube_video_id, display_name: S.videos.creator_display_name, status: S.videos.visibility_status, created_at: S.videos.created_at })
      .from(S.videos);
    const withCreator = q ? base.leftJoin(S.xUsers, eq(S.xUsers.id, S.videos.creator_x_user_id)) : base;
    const withEvent = event ? withCreator.innerJoin(S.videoEvents, eq(S.videoEvents.video_id, S.videos.id)) : withCreator;
    const rows = await withEvent.where(where).orderBy(...videoReviewQueueOrder).limit(pageSize).offset(offset);
    const countBase = refDb.select({ c: sql`COUNT(*)` }).from(S.videos);
    const countCreator = q ? countBase.leftJoin(S.xUsers, eq(S.xUsers.id, S.videos.creator_x_user_id)) : countBase;
    const countEvent = event ? countCreator.innerJoin(S.videoEvents, eq(S.videoEvents.video_id, S.videos.id)) : countCreator;
    const total = Number((await countEvent.where(where).limit(1))[0]?.c ?? 0);
    const events = await refDb.select({ id: S.events.id, title: S.events.title }).from(S.events).where(eq(S.events.visibility_status, "public")).orderBy(desc(S.events.start_time)).limit(100);
    return { status, page: Math.floor(offset / pageSize) + 1, pageSize, total, rows, events };
  }

  async function refUsers({ q: qRaw, status: statusRaw, view: viewRaw, page: pageRaw }) {
    const q = qRaw ?? "";
    const status = statusRaw ?? "";
    const view = viewRaw ?? "discord";
    const activeView = view === "xid" || view === "permissions" ? view : "discord";
    const { pageSize, offset } = clampPaging({ page: pageRaw || "1", pageSize: 50, defaultPageSize: 50, maxPageSize: 50 });
    let userRows = [];
    let xRows = [];
    let totalUsers = 0;
    let totalXUsers = 0;
    let permissionSettings = { default_editable_fields: null, upcoming_editable_fields: null };
    const rawQuery = q.trim();
    const escapedRaw = escapeLike(rawQuery);
    const lowerTerm = `%${escapedRaw.toLowerCase()}%`;
    const normalizedXQuery = normalizeXId(rawQuery);
    const escapedX = escapeLike(normalizedXQuery || rawQuery);
    const xTerm = `%${escapedX.toLowerCase()}%`;
    if (activeView === "permissions") {
      const rows = await refDb.select({ default_editable_fields: S.systemSettings.default_editable_fields, upcoming_editable_fields: S.systemSettings.upcoming_editable_fields }).from(S.systemSettings).where(eq(S.systemSettings.id, "default")).limit(1);
      if (rows[0]) permissionSettings = rows[0];
    } else if (activeView === "xid") {
      const xFilter = q
        ? or(
            like(sql`lower(${S.xUsers.id})`, xTerm),
            like(sql`lower(${S.xUsers.x_name})`, lowerTerm),
            sql`EXISTS (
              SELECT 1 FROM ${S.xUserAccountLinks} link
              INNER JOIN ${S.users} auth_user ON auth_user.id = link.auth_user_id
              WHERE link.x_user_id = ${S.xUsers.id}
                AND (lower(COALESCE(auth_user.name, '')) LIKE ${lowerTerm} OR auth_user.id = ${rawQuery})
            )`,
          )
        : undefined;
      const baseRows = await refDb.select({ id: S.xUsers.id, x_name: S.xUsers.x_name, approval_status: S.xUsers.approval_status }).from(S.xUsers).where(xFilter).orderBy(S.xUsers.id).limit(pageSize).offset(offset);
      totalXUsers = Number((await refDb.select({ c: sql`COUNT(*)` }).from(S.xUsers).where(xFilter).limit(1))[0]?.c ?? 0);
      const enrichment = await loadAdminXUserEnrichment(refDb, baseRows.map((row) => row.id));
      xRows = baseRows.map((row) => ({
        ...row,
        icon_url: null,
        ...(enrichment.get(row.id) ?? { primary_auth_user_id: null, primary_auth_user_name: null, linked_auth_user_count: 0, active_holder_count: 0 }),
      }));
    } else {
      const statusFilter =
        status === "banned" ? eq(S.users.is_banned, 1)
        : status === "admin" ? eq(S.users.role, "admin")
        : status === "moderator" ? eq(S.users.role, "moderator")
        : status === "active" ? eq(S.users.is_banned, 0)
        : status === "can_create_events" ? eq(S.users.can_create_events, 1)
        : status === "tos_not_accepted" ? eq(S.users.is_tos_accepted, 0)
        : status === "no_active_x" ? isNull(S.users.active_x_user_id)
        : undefined;
      const queryFilter = q
        ? or(
            like(sql`lower(${S.users.name})`, lowerTerm),
            like(sql`lower(${S.users.email})`, lowerTerm),
            eq(S.users.id, q),
            sql`EXISTS (
              SELECT 1 FROM ${S.xUserAccountLinks} active_link
              INNER JOIN ${S.xUsers} active_x ON active_x.id = active_link.x_user_id
              WHERE active_link.auth_user_id = ${S.users.id}
                AND active_x.approval_status = 'approved'
                AND lower(active_x.id) = lower(${S.users.active_x_user_id})
                AND (lower(active_x.id) LIKE ${xTerm} OR lower(active_x.x_name) LIKE ${lowerTerm})
            )`,
          )
        : undefined;
      const where = and(isNotNull(S.users.discord_id), queryFilter, statusFilter);
      userRows = await refDb
        .select({ id: S.users.id, name: S.users.name, image: S.users.image, role: S.users.role, is_banned: S.users.is_banned, can_create_events: S.users.can_create_events, active_x_user_id: S.users.active_x_user_id, active_x_name: sql`NULL`, created_at: S.users.created_at })
        .from(S.users).where(where).orderBy(desc(S.users.created_at)).limit(pageSize).offset(offset);
      totalUsers = Number((await refDb.select({ c: sql`COUNT(*)` }).from(S.users).where(where).limit(1))[0]?.c ?? 0);
      const visibleUserIds = userRows.map((u) => u.id);
      const linkedXRows = visibleUserIds.length > 0
        ? await refDb
            .select({ user_id: S.xUserAccountLinks.auth_user_id, x_user_id: S.xUsers.id, x_name: S.xUsers.x_name, approval_status: S.xUsers.approval_status })
            .from(S.xUserAccountLinks)
            .innerJoin(S.xUsers, eq(S.xUsers.id, S.xUserAccountLinks.x_user_id))
            .where(and(inArray(S.xUserAccountLinks.auth_user_id, visibleUserIds), eq(S.xUsers.approval_status, "approved")))
            .orderBy(S.xUsers.id)
        : [];
      const byUser = new Map();
      for (const row of linkedXRows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
      userRows = userRows.map((row) => {
        const activeId = normalizeXId(row.active_x_user_id);
        const active = activeId ? (byUser.get(row.id) ?? []).find((link) => normalizeXId(link.x_user_id) === activeId) : undefined;
        return { ...row, active_x_name: active?.x_name ?? null };
      });
    }
    return { view: activeView, page: Math.floor(offset / pageSize) + 1, pageSize, total: activeView === "xid" ? totalXUsers : totalUsers, users: userRows, xUsers: xRows, permissionSettings };
  }

  async function refUserDetail(id) {
    const requiredMajor = await getLatestPublishedMajorTerms(refDb);
    const userResult = (await refDb.select({ row: S.users, reaccept_required: termsReacceptRequiredValue(requiredMajor) }).from(S.users).where(eq(S.users.id, id)).limit(1))[0];
    if (!userResult) return null;
    const user = { ...userResult.row, terms_reaccept_required: userResult.reaccept_required === 1 ? 1 : 0 };
    const xIds = (await getLinkedXUsersForAuthUser(refDb, user.id)).map((row) => ({ id: row.x_user_id, x_name: row.x_name, icon_url: row.icon_url, approval_status: row.approval_status }));
    const recentVideos = await refDb.select({ id: S.videos.id, title: S.videos.title, status: S.videos.visibility_status, created_at: S.videos.created_at }).from(S.videos).where(eq(S.videos.submitted_by_user_id, user.id)).orderBy(desc(S.videos.created_at)).limit(20);
    const audit = (cols) => cols.map((h) => ({ id: h.id, created_at: h.created_at, table_name: h.table_name, operation: h.operation, actor_user_id: h.actor_user_id, target_id: h.target_id }));
    const recentByOperator = audit(await refDb.select().from(S.auditLogs).where(eq(S.auditLogs.actor_user_id, user.id)).orderBy(desc(S.auditLogs.created_at)).limit(15));
    const recentOnUser = audit(await refDb.select().from(S.auditLogs).where(eq(S.auditLogs.target_id, user.id)).orderBy(desc(S.auditLogs.created_at)).limit(15));
    let likeCount = 0;
    let bookmarkCount = 0;
    if (user.active_x_user_id) {
      const rows = await refDb.select({ interaction_type: S.videoInteractions.interaction_type, c: sql`COUNT(*)` }).from(S.videoInteractions).where(eq(S.videoInteractions.x_user_id, user.active_x_user_id)).groupBy(S.videoInteractions.interaction_type);
      for (const r of rows) {
        if (r.interaction_type === "like") likeCount = Number(r.c ?? 0);
        if (r.interaction_type === "bookmark") bookmarkCount = Number(r.c ?? 0);
      }
    }
    const linkRequests = await refDb
      .select({ id: S.xIdentityRequests.id, requested_x_id: S.xIdentityRequests.requested_x_id, link_type: S.xIdentityRequests.request_type, target_x_user_id: S.xIdentityRequests.target_x_user_id, status: S.xIdentityRequests.status, requested_at: S.xIdentityRequests.requested_at })
      .from(S.xIdentityRequests).where(eq(S.xIdentityRequests.requested_by_auth_user_id, user.id)).orderBy(desc(S.xIdentityRequests.requested_at)).limit(10);
    return {
      user: {
        id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified ? user.emailVerified.getTime() : null, discord_id: user.discord_id, role: user.role,
        can_create_events: user.can_create_events, is_tos_accepted: user.is_tos_accepted, terms_reaccept_required: user.terms_reaccept_required,
        is_banned: user.is_banned, is_notification_enabled: user.is_notification_enabled, active_x_user_id: user.active_x_user_id, created_at: user.created_at,
      },
      xIds, recentVideos, recentByOperator, recentOnUser, likeCount, bookmarkCount, linkRequests,
    };
  }

  async function refXLink(secret) {
    const LINK_TYPES = ["new_link", "existing_link", "alias"];
    const pendingBase = await refDb
      .select({ id: S.xIdentityRequests.id, requested_x_id: S.xIdentityRequests.requested_x_id, requested_by_auth_user_id: S.xIdentityRequests.requested_by_auth_user_id, discord_name: S.users.name, discord_image: S.users.image, requested_at: S.xIdentityRequests.requested_at, request_type: S.xIdentityRequests.request_type, target_x_user_id: S.xIdentityRequests.target_x_user_id })
      .from(S.xIdentityRequests).leftJoin(S.users, eq(S.users.id, S.xIdentityRequests.requested_by_auth_user_id))
      .where(and(eq(S.xIdentityRequests.status, "pending"), inArray(S.xIdentityRequests.request_type, LINK_TYPES)))
      .orderBy(desc(S.xIdentityRequests.requested_at)).limit(100);
    const recentRejected = await refDb
      .select({ id: S.xIdentityRequests.id, requested_x_id: S.xIdentityRequests.requested_x_id, requested_by_auth_user_id: S.xIdentityRequests.requested_by_auth_user_id, request_type: S.xIdentityRequests.request_type, requested_at: S.xIdentityRequests.requested_at })
      .from(S.xIdentityRequests).where(and(eq(S.xIdentityRequests.status, "rejected"), inArray(S.xIdentityRequests.request_type, LINK_TYPES)))
      .orderBy(desc(S.xIdentityRequests.requested_at)).limit(10);
    const logs = await refDb
      .select({ id: S.auditLogs.id, table_name: S.auditLogs.table_name, operation: S.auditLogs.operation, target_id: S.auditLogs.target_id, before_json: S.auditLogs.before_json, after_json: S.auditLogs.after_json, created_at: S.auditLogs.created_at })
      .from(S.auditLogs).where(and(inArray(S.auditLogs.table_name, ["x_identity_requests", "x_user_account_links", "x_users"]), inArray(S.auditLogs.operation, ["UPDATE", "CREATE", "DELETE"])))
      .orderBy(desc(S.auditLogs.created_at)).limit(30);
    const enriched = await enrichXLinkPendingRows(refDb, pendingBase);
    const pending = await Promise.all(enriched.map(async (row) => ({
      ...row,
      requested_icon_url: await resolveManageXIconUrl({ iconUrl: row.requested_icon_url, approvalStatus: row.requested_approval_status, authSecret: secret }),
      target_icon_url: await resolveManageXIconUrl({ iconUrl: row.target_icon_url, approvalStatus: row.target_approval_status, authSecret: secret }),
    })));
    return {
      pending,
      recentRejected,
      recentAudit: logs.map((l) => ({ id: l.id, table_name: l.table_name, operation: l.operation, target_id: l.target_id, created_at: l.created_at, changedKeys: parseAuditDiff(l.before_json, l.after_json).changedKeys.slice(0, 6) })),
    };
  }

  const bySort = (rows, key) => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));

  // ---------------- T02: authz ----------------
  const ENDPOINTS = ["/users", "/users/u_alice", "/videos", "/events", "/moderation", "/x-link-requests", "/x-id-merges", "/events/templates", "/events/new", "/event-groups"];

  test("T02 guest / expired / unknown token -> 401, no-store, one D1 statement at most", async () => {
    for (const path of ENDPOINTS) {
      for (const token of [null, "tok-expired", "tok-nope"]) {
        const r = await call(`/api/admin-read${path}`, token);
        assert.equal(r.status, 401, `${path} ${token}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(r.body, { error: "Unauthorized" });
      }
    }
  });

  test("T02 user / moderator roles -> 403 with /dashboard redirect hint; banned admin -> 403; only admin passes", async () => {
    for (const path of ENDPOINTS) {
      for (const token of ["tok-alice", "tok-bob"]) {
        const r = await call(`/api/admin-read${path}`, token);
        assert.equal(r.status, 403, `${path} ${token}`);
        assert.deepEqual(r.body, { error: "Forbidden", redirect: "/dashboard" });
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.equal(r.stats.statements, 1, "role is decided from the session lookup only");
      }
      const banned = await call(`/api/admin-read${path}`, "tok-badmin");
      assert.equal(banned.status, 403);
      assert.deepEqual(banned.body, { error: "Forbidden", message: "User is banned" });
      assert.equal(banned.stats.statements, 1);
      assert.equal((await call(`/api/admin-read${path}`, "tok-carol")).status, 200, "carol is an admin in the seed");
      assert.equal((await call(`/api/admin-read${path}`, "tok-root")).status, 200);
    }
  });

  test("T02 non-GET methods are not routed (no write surface)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await call("/api/admin-read/users", "tok-root", { method });
      assert.ok(r.status === 404 || r.status === 405, `${method} -> ${r.status}`);
      assert.equal(r.stats.writes, 0);
    }
  });

  test("T04 failure mode: D1 failure -> list pages degrade like CURRENT's try/catch (200 empty); the rest 503 {error:unavailable} without internals", async () => {
    const failing = (match) => {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      d1.prepare = (text) => {
        if (match.test(text)) throw new Error("secret-internal tok-root");
        return prepare(text);
      };
      return d1;
    };
    for (const path of ["/users?view=discord", "/users?view=xid", "/users?view=permissions", "/videos"]) {
      const r = await call(`/api/admin-read${path}`, "tok-root", { d1: failing(/FROM "user" u WHERE|FROM x_users x WHERE|system_settings|FROM videos/) });
      assert.equal(r.status, 200, path);
      assert.equal(r.body.degraded, true, path);
      assert.deepEqual(r.body.users ?? r.body.videos, [], path);
      assert.equal(r.body.paging.total, 0, path);
      assert.doesNotMatch(JSON.stringify(r.body), /secret-internal|tok-root/);
    }
    for (const [path, match] of [
      ["/events", /FROM events/],
      ["/moderation", /video_moderation_cases/],
      ["/users/u_alice", /required_major/],
    ]) {
      const r = await call(`/api/admin-read${path}`, "tok-root", { d1: failing(match) });
      assert.equal(r.status, 503, path);
      assert.deepEqual(r.body, { error: "unavailable" });
      assert.equal(r.headers.get("cache-control"), "private, no-store");
    }
  });

  // ---------------- moderation ----------------
  test("T01 moderation: equals CURRENT for every filter combination (type, status, overdue)", async () => {
    for (const query of ["", "?status=all", "?status=resolved", "?type=rights", "?type=duplicate&status=all", "?overdue=1", "?type=operator", "?status=bogus&type=bogus", "?status=rejected&overdue=1"]) {
      const params = Object.fromEntries(new URLSearchParams(query));
      const r = await get(`/api/admin-read/moderation${query}`);
      assert.deepEqual(r.body.cases, canon(await refModeration(params)), query);
      assert.ok(r.body.cases.length <= 100);
    }
    const defaults = (await get("/api/admin-read/moderation")).body;
    assert.equal(defaults.status, "open");
    assert.equal(defaults.type, "all");
    assert.equal(defaults.cases.length, 100, "limit 100 (105+ open operator cases seeded)");
    assert.ok((await get("/api/admin-read/moderation?type=x_reapply")).body.cases[0].video_title === null, "left join keeps cases whose video is missing");
  });

  // ---------------- events ----------------
  test("T01 events: equals CURRENT for filter x sort x q, limit 60, accepting uses the shared SQL", async () => {
    for (const query of ["", "?filter=public", "?filter=private", "?filter=accepting", "?sort=oldest", "?sort=upcoming&filter=accepting", "?q=Admin%20Event%20o", "?q=100%25", "?q=a-bulk1", "?filter=bogus&sort=bogus", "?filter=public&q=ended"]) {
      const params = Object.fromEntries(new URLSearchParams(query));
      const r = await get(`/api/admin-read/events${query}`);
      assert.deepEqual(r.body.events, canon(await refEvents(params, r.body.now)), query);
      assert.ok(r.body.events.length <= 60);
    }
    assert.equal((await get("/api/admin-read/events")).body.events.length, 60);
    const accepting = (await get("/api/admin-read/events?filter=accepting")).body.events.map((e) => e.id);
    assert.ok(accepting.includes("a-open") && accepting.includes("a-point"));
    assert.ok(!accepting.includes("a-closedentry") && !accepting.includes("a-priv") && !accepting.includes("a-ended"));
  });

  // ---------------- videos ----------------
  test("T01 videos: rows, total, paging and event options equal CURRENT (q, status/group, event, page)", async () => {
    for (const query of [
      "", "?status=review", "?status=pending", "?status=public", "?status=closed", "?status=voided", "?status=all", "?status=bogus",
      "?q=Admin", "?q=100%25", "?q=zed", "?q=ALICE_X", "?q=Creator%20av-bulk0", "?event=a-open", "?event=a-open&status=review", "?event=a-ended&q=ZED",
      "?page=2", "?page=3", "?page=0", "?page=abc", "?page=99",
    ]) {
      const params = Object.fromEntries(new URLSearchParams(query));
      const r = await get(`/api/admin-read/videos${query}`);
      const ref = await refVideos(params);
      assert.deepEqual(r.body.videos, canon(ref.rows), query);
      assert.deepEqual(r.body.paging, { page: ref.page, pageSize: 50, total: ref.total }, query);
      assert.equal(r.body.status, ref.status);
      assert.deepEqual(r.body.events, canon(ref.events), query);
      assert.equal(r.body.degraded, false);
      assert.equal(r.body.reviewSummaries, "deferred");
    }
    assert.equal((await get("/api/admin-read/videos?status=review&event=a-open")).body.paging.total, 1);
  });

  // ---------------- users ----------------
  test("T01 users: discord / xid / permissions views equal CURRENT (filters, q, paging)", async () => {
    const queries = [
      "", "?view=discord&status=banned", "?status=admin", "?status=moderator", "?status=active", "?status=can_create_events", "?status=tos_not_accepted",
      "?status=no_active_x", "?q=alice", "?q=ALICE_X", "?q=%40alice_x", "?q=u_alice", "?q=%20alice%20", "?q=100%25", "?q=Pager&page=2", "?page=2", "?page=3",
      "?q=orph", "?view=permissions", "?view=bogus",
      "?view=xid", "?view=xid&q=alice", "?view=xid&q=orph", "?view=xid&q=Name%20alice", "?view=xid&q=u_ivy", "?view=xid&q=bulk&page=2", "?view=xid&q=100%25", "?view=xid&page=2",
    ];
    for (const query of queries) {
      const params = Object.fromEntries(new URLSearchParams(query));
      const r = await get(`/api/admin-read/users${query}`);
      const ref = await refUsers(params);
      assert.equal(r.body.view, ref.view, query);
      assert.deepEqual(r.body.users, canon(ref.users), query);
      assert.deepEqual(r.body.xUsers, canon(ref.xUsers), query);
      assert.deepEqual(r.body.permissionSettings, ref.permissionSettings, query);
      assert.deepEqual(r.body.paging, { page: ref.page, pageSize: 50, total: ref.total }, query);
      assert.equal(r.body.degraded, false);
    }
    assert.deepEqual((await get("/api/admin-read/users?view=links")).body, { redirect: "/admin/x-link-requests" });
  });

  test("T01 users: active X name via normalized IDs; orphan links and active holders in the xid enrichment", async () => {
    const discord = (await get("/api/admin-read/users?q=alice")).body.users.find((u) => u.id === "u_alice");
    assert.equal(discord.active_x_name, "X alice_x", "' ALICE_X ' resolves to the approved linked alice_x");
    const orphan = (await get("/api/admin-read/users?view=xid&q=orph")).body.xUsers.find((x) => x.id === "orph_x");
    assert.deepEqual(
      { id: orphan.primary_auth_user_id, name: orphan.primary_auth_user_name, linked: orphan.linked_auth_user_count, holders: orphan.active_holder_count },
      { id: "u_ghost", name: "Name ivy", linked: 2, holders: 1 },
      "primary id includes the orphan link, name skips it, active holder matches '@Orph_X ' after normalization",
    );
    assert.equal(orphan.icon_url, null);
  });

  test("T01 user detail: every section equals CURRENT for every seeded user; 404 for unknown", async () => {
    const ids = sqlite.prepare('SELECT id FROM "user" ORDER BY id').all().map((r) => r.id);
    for (const id of ids) {
      const r = await get(`/api/admin-read/users/${encodeURIComponent(id)}`);
      // CURRENT's linked-X select has no ORDER BY (undefined order); the API orders by x_users.id, so compare as a set.
      const expected = canon(await refUserDetail(id));
      const sortX = (body) => ({ ...body, xIds: bySort(body.xIds, "id") });
      assert.deepEqual(sortX(r.body), sortX(expected), id);
      const xIdList = r.body.xIds.map((x) => x.id);
      assert.deepEqual(xIdList, [...xIdList].sort(), "API order is x_users.id");
      assert.equal(r.stats.statements, 3, "session + detail + audit");
    }
    const alice = (await get("/api/admin-read/users/u_alice")).body;
    assert.equal(alice.recentOnUser.length, 15);
    assert.equal(alice.recentByOperator.length, 15);
    assert.equal(alice.recentVideos.length, 20);
    assert.equal(alice.likeCount, 3);
    assert.equal(alice.bookmarkCount, 1);
    assert.equal(alice.user.terms_reaccept_required, 0);
    assert.equal((await get("/api/admin-read/users/u_bob")).body.user.terms_reaccept_required, 1, "accepted an older major");
    const missing = await call("/api/admin-read/users/nope", "tok-root");
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "private, no-store");
  });

  test("T01 x-link-requests: pending (enriched, signed icons), rejected and audit equal CURRENT incl. legacy ids and bad namespaces", async () => {
    const realNow = Date.now;
    const fixedNow = Math.floor(realNow() / 60_000) * 60_000 + 1000;
    Date.now = () => fixedNow;
    try {
      const r = await get("/api/admin-read/x-link-requests");
      assert.deepEqual(r.body, canon(await refXLink(SECRET)));
      assert.equal(r.body.pending.length, 100);
      assert.equal(r.body.recentRejected.length, 10);
      assert.equal(r.body.recentAudit.length, 30);
      const byId = Object.fromEntries(r.body.pending.map((p) => [p.id, p]));
      assert.match(byId.xl1.requested_icon_url, /^\/api\/media\/manage-x-icon\/xicons\/ic_int\.png\?v=1&exp=\d+&sig=[A-Za-z0-9_-]+$/);
      assert.equal(byId.xl2.requested_icon_url, null, "pending X is not signed");
      assert.equal(byId.xl2.target_icon_url, "https://pbs.example.test/ic_ext.png");
      assert.equal(byId.xl3.target_icon_url, null, "video-icons namespace is not allowed");
      assert.equal(byId.xl3.requested_x_name, "Legacy cased", "legacy cased id resolved via lower(trim(id))");
      // absent secret: internal icons fail closed (null), never unsigned internal URLs
      const noSecret = await call("/api/admin-read/x-link-requests", "tok-root", { secret: "" });
      assert.equal(noSecret.status, 200);
      assert.deepEqual(noSecret.body, canon(await refXLink("")));
      assert.equal(noSecret.body.pending.find((p) => p.id === "xl1").requested_icon_url, null);
      assert.doesNotMatch(JSON.stringify(r.body), /test-secret-mig-0625|before_json|after_json/);
    } finally {
      Date.now = realNow;
    }
  });

  test("T01 x-id-merges: requests (50), reverts (100), impact + preview of the selected request equal CURRENT", async () => {
    const { fetchXIdMergeImpact, fetchXIdMergePreview } = await import("../../../src/lib/admin/xIdMergeImpact.ts");
    const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
    const dialect = new SQLiteSyncDialect();
    const mergeBase = (r) => ({ id: r.id, request_type: r.request_type, status: r.status, source_x_user_id: r.source_x_user_id, target_x_user_id: r.target_x_user_id, parent_request_id: r.parent_request_id, revert_deadline_at: r.revert_deadline_at, updated_at: r.updated_at, source_name: r.source_name, has_restore_snapshot: Boolean(r.restore_snapshot_json) });
    for (const impact of ["", "mg1", "mg2", "mg3", "mg4", "nope", "mgb1", "  mg1  "]) {
      const query = impact ? `?impact=${encodeURIComponent(impact)}` : "";
      const r = await get(`/api/admin-read/x-id-merges${query}`);
      const rows = await refDb
        .select({ id: S.xIdentityRequests.id, request_type: S.xIdentityRequests.request_type, status: S.xIdentityRequests.status, source_x_user_id: S.xIdentityRequests.source_x_user_id, target_x_user_id: S.xIdentityRequests.target_x_user_id, parent_request_id: S.xIdentityRequests.parent_request_id, restore_snapshot_json: S.xIdentityRequests.restore_snapshot_json, revert_deadline_at: S.xIdentityRequests.revert_deadline_at, updated_at: S.xIdentityRequests.updated_at, source_name: S.xUsers.x_name })
        .from(S.xIdentityRequests).leftJoin(S.xUsers, eq(S.xUsers.id, S.xIdentityRequests.source_x_user_id))
        .where(eq(S.xIdentityRequests.request_type, "merge")).orderBy(desc(S.xIdentityRequests.updated_at)).limit(50);
      const targetIds = Array.from(new Set(rows.map((x) => x.target_x_user_id).filter(Boolean)));
      const targetNames = new Map((await refDb.select({ id: S.xUsers.id, name: S.xUsers.x_name }).from(S.xUsers).where(inArray(S.xUsers.id, targetIds))).map((x) => [x.id, x.name]));
      const selectedId = impact.trim().slice(0, 128);
      const selected = rows.find((x) => x.id === selectedId && Boolean(x.source_x_user_id) && (x.status === "pending" || x.status === "approved"));
      const selImpact = selected?.source_x_user_id ? await fetchXIdMergeImpact(refDb, selected.source_x_user_id) : [];
      const objectDb = { all: async (query) => { const built = dialect.sqlToQuery(query); return sqlite.prepare(built.sql).all(...built.params).map((row) => ({ ...row })); } };
      const selPreview = selected?.source_x_user_id ? await fetchXIdMergePreview(objectDb, selected.source_x_user_id) : [];
      const expected = rows.map((x) => ({ ...mergeBase(x), target_name: x.target_x_user_id ? targetNames.get(x.target_x_user_id) ?? null : null, impact: x.id === selectedId ? selImpact : [], preview: x.id === selectedId ? selPreview : [] }));
      assert.deepEqual(r.body.requests, canon(expected), query);
      assert.equal(r.body.requests.length, 50);
      if (impact === "mg1") assert.ok(r.body.requests.find((x) => x.id === "mg1").impact.some((i) => i.count > 0), "impact counts non-empty");
      if (impact === "mg1") assert.equal(r.stats.statements, 3);
      if (!impact) assert.equal(r.stats.statements, 2);
    }
    const rev = await get("/api/admin-read/x-id-merges?view=reverts");
    const refRevs = await refDb.select().from(S.xIdentityRequests).where(eq(S.xIdentityRequests.request_type, "revert_merge")).orderBy(desc(S.xIdentityRequests.updated_at)).limit(100);
    assert.deepEqual(rev.body.reverts, canon(refRevs.map((x) => ({ id: x.id, status: x.status, parent_request_id: x.parent_request_id, revert_deadline_at: x.revert_deadline_at, has_restore_snapshot: Boolean(x.restore_snapshot_json) }))));
    assert.equal(rev.body.reverts.length, 100);
    assert.doesNotMatch(JSON.stringify(rev.body) + JSON.stringify((await get("/api/admin-read/x-id-merges?impact=mg1")).body), /restore_snapshot_json|"a":1/);
  });

  test("T01 event templates / new event: guard (TOS, re-accept, CostGuard) decides an empty list exactly like requireAdminWrite", async () => {
    const { evaluateWriteIdentity } = await import("../../../src/lib/auth/writeGuardCore.ts");
    const { evaluateCostGuardCore } = await import("../../../src/lib/auth/writeGuardCore.ts");
    async function refGuardList(userId) {
      const requiredMajor = await getLatestPublishedMajorTerms(refDb);
      const u = (await refDb.select({ role: S.users.role, is_banned: S.users.is_banned, is_tos_accepted: S.users.is_tos_accepted, terms_reaccept_required: termsReacceptRequiredValue(requiredMajor) }).from(S.users).where(eq(S.users.id, userId)).limit(1))[0];
      const deny = evaluateWriteIdentity({ role: u.role, is_banned: u.is_banned ?? 0, is_tos_accepted: u.is_tos_accepted ?? 0, terms_reaccept_required: u.terms_reaccept_required === 1 ? 1 : 0 }, "admin");
      if (deny) return { guardOk: false, templates: [] };
      const row = (await refDb.select({ operation_mode: S.systemSettings.operation_mode, disabled_features_json: S.systemSettings.disabled_features_json, cost_guard_exception_until: S.systemSettings.cost_guard_exception_until, cost_guard_exception_features_json: S.systemSettings.cost_guard_exception_features_json }).from(S.systemSettings).where(eq(S.systemSettings.id, "default")).limit(1))[0];
      if (!row) return { guardOk: false, templates: [] };
      const cg = evaluateCostGuardCore({ feature: "admin_event_templates", operationMode: row.operation_mode, disabledFeaturesJson: row.disabled_features_json, exceptionUntil: row.cost_guard_exception_until, exceptionFeaturesJson: row.cost_guard_exception_features_json, now: Math.floor(Date.now() / 1000) });
      if (cg.blocked) return { guardOk: false, templates: [] };
      const templates = await refDb.select({ id: S.eventTemplates.id, name: S.eventTemplates.name, description: S.eventTemplates.description, source_event_id: S.eventTemplates.source_event_id, updated_at: S.eventTemplates.updated_at }).from(S.eventTemplates).orderBy(desc(S.eventTemplates.updated_at));
      return { guardOk: true, templates };
    }
    const run = async (token, userId) => {
      const t = await get("/api/admin-read/events/templates", token);
      assert.deepEqual(t.body, canon(await refGuardList(userId)), `${token} templates`);
      assert.ok(t.stats.statements <= 3);
      const n = await get("/api/admin-read/events/new?template=tpl2", token);
      const ref = await refGuardList(userId);
      assert.equal(n.body.guardOk, ref.guardOk);
      assert.deepEqual(n.body.templates, canon(ref.templates));
      assert.equal(n.body.userId, userId);
      assert.equal(n.body.templateName, "Template 2");
      assert.equal(n.body.templateSettingsJson, '{"event_type":"event","n":2}');
      return t.body;
    };
    assert.equal((await run("root", "u_root")).templates.length, 5);
    assert.equal((await run("carol", "u_carol")).guardOk, false, "admin without TOS acceptance -> empty list");
    const unknown = await get("/api/admin-read/events/new?template=nope", "root");
    assert.equal(unknown.body.templateName, null);
    assert.equal(unknown.body.templateSettingsJson, null);
    assert.equal((await get("/api/admin-read/events/new?template=tpl-big", "root")).body.templateSettingsJson, null, "> 64 KiB not returned");
    assert.equal((await get("/api/admin-read/events/new", "root")).body.templateId, "");
    try {
      for (const [sets, expected] of [
        ["operation_mode = 'read_only'", false],
        ["operation_mode = 'economy'", true],
        ["disabled_features_json = '[\"admin_event_templates\"]'", false],
        ["disabled_features_json = 'garbage'", false],
        [`operation_mode = 'maintenance', cost_guard_exception_until = ${Math.floor(Date.now() / 1000) + 600}, cost_guard_exception_features_json = '["admin_event_templates"]'`, true],
      ]) {
        sqlite.exec(`UPDATE system_settings SET ${sets} WHERE id = 'default'`);
        const body = await run("root", "u_root");
        assert.equal(body.guardOk, expected, sets);
        sqlite.exec(`UPDATE system_settings SET operation_mode = 'normal', disabled_features_json = NULL, cost_guard_exception_until = NULL, cost_guard_exception_features_json = NULL WHERE id = 'default'`);
      }
    } finally {
      sqlite.exec(`UPDATE system_settings SET operation_mode = 'normal', disabled_features_json = NULL, cost_guard_exception_until = NULL, cost_guard_exception_features_json = NULL WHERE id = 'default'`);
    }
  });

  test("T01 event groups: list filters/counts and edit detail (members, first option page) equal CURRENT", async () => {
    const { queryEventGroupEventOptions } = await import("../../../src/lib/admin/eventGroupEventOptions.ts");
    for (const query of ["", "?visibility=public", "?visibility=private", "?visibility=archived", "?type=series", "?type=other&visibility=archived", "?type=bogus", "?type=toString", "?visibility=zzz"]) {
      const sp = Object.fromEntries(new URLSearchParams(query));
      const visibilityFilter = ["public", "private", "archived"].includes(sp.visibility) ? sp.visibility : "any";
      const typeFilter = sp.type && sp.type in { series: 1, genre: 1, related: 1, collection: 1, other: 1 } ? sp.type : "any";
      const conds = [visibilityFilter !== "any" ? eq(S.eventGroups.visibility_status, visibilityFilter) : undefined, typeFilter !== "any" ? eq(S.eventGroups.group_type, typeFilter) : undefined].filter((x) => x !== undefined);
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
      const rows = await refDb
        .select({ id: S.eventGroups.id, name: S.eventGroups.name, slug: S.eventGroups.slug, group_type: S.eventGroups.group_type, visibility_status: S.eventGroups.visibility_status, sort_order: S.eventGroups.sort_order, event_count: sql`count(${S.eventGroupEvents.event_id})`.as("event_count") })
        .from(S.eventGroups).leftJoin(S.eventGroupEvents, eq(S.eventGroupEvents.event_group_id, S.eventGroups.id)).where(where).groupBy(S.eventGroups.id)
        .orderBy(asc(S.eventGroups.sort_order), asc(S.eventGroups.name)).limit(100);
      const r = await get(`/api/admin-read/event-groups${query}`);
      assert.deepEqual(r.body.groups, canon(rows.map((x) => ({ ...x, event_count: Number(x.event_count) }))), query);
    }
    for (const id of ["eg1", "eg2", "eg3", "eg-empty"]) {
      const g = (await refDb.select().from(S.eventGroups).where(eq(S.eventGroups.id, id)).limit(1))[0];
      const members = await refDb.select({ event_id: S.eventGroupEvents.event_id, title: S.events.title, start_time: S.events.start_time }).from(S.eventGroupEvents).innerJoin(S.events, eq(S.events.id, S.eventGroupEvents.event_id)).where(eq(S.eventGroupEvents.event_group_id, id)).orderBy(desc(S.events.start_time), asc(S.events.id));
      const options = await queryEventGroupEventOptions(refDb, { groupId: id, query: "", cursor: null });
      const r = await get(`/api/admin-read/event-groups/${id}`);
      assert.deepEqual(r.body.group, canon({ id: g.id, name: g.name, slug: g.slug, description: g.description, group_type: g.group_type, icon_url: g.icon_url, accent_color: g.accent_color, visibility_status: g.visibility_status, sort_order: g.sort_order, updated_at: g.updated_at }), id);
      assert.deepEqual(r.body.members, canon(members), id);
      assert.deepEqual(r.body.eventOptions, canon(options.options), id);
      assert.equal(r.body.nextCursor, options.nextCursor, id);
      assert.equal(r.stats.statements, 3);
    }
    assert.equal((await call("/api/admin-read/event-groups/nope", "tok-root")).status, 404);
  });

  test("T04 responses never carry secrets (tokens, audit before/after payloads, session data)", async () => {
    for (const path of ["/users/u_alice", "/users", "/videos", "/events", "/moderation", "/users?view=xid", "/x-link-requests"]) {
      const text = JSON.stringify((await get(`/api/admin-read${path}`)).body);
      assert.doesNotMatch(text, /sessionToken|tok-|"secret"|before_json|after_json|inverse_patch|actor_snapshot/, path);
    }
  });

  test("S2 budget summary (informational): max D1 statements and binds per endpoint", async () => {
    const summary = {};
    for (const path of ["/users", "/users?q=alice&status=active", "/users?view=xid&q=alice", "/users?view=permissions", "/users/u_alice", "/videos?q=a&event=a-open&status=review", "/events?filter=accepting&q=a", "/moderation?overdue=1"]) {
      const r = await get(`/api/admin-read${path}`);
      summary[path] = { statements: r.stats.statements, binds: r.stats.maxBinds };
    }
    console.log("[MIG-0625] D1 usage per request", JSON.stringify(summary));
    assert.ok(Object.values(summary).every((s) => s.statements <= 3 && s.binds <= 100));
  });
}

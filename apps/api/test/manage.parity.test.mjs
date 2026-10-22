import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { NOW, seed, USERS } from "./support/manageSeed.mjs";

// MIG-0624 parity: the same seed is read by CURRENT's loaders (the real src/** pure functions plus the drizzle
// queries copied from app/(manage)/**) and by the Hono /api/manage/* routes.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { and, asc, desc, eq, inArray, sql } = await import("drizzle-orm");
  const S = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const MA = await import("../../../src/lib/auth/manageAuthorization.ts");
  const PR = await import("../../../src/lib/auth/permissions/permissionResolver.ts");
  const { PRESET_DEFINITIONS } = await import("../../../src/lib/auth/permissions/presets.ts");
  const { compareEventsByUpcomingPriority } = await import("../../../src/lib/utils/eventOrdering.ts");
  const { computeEventStatus, isAcceptingEntries } = await import("../../../src/lib/utils/eventStatusCore.ts");
  const { resolveActiveXUserId } = await import("../../../src/lib/auth/resolveActiveXId.ts");
  const { getHeaderLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/headerLinkedXUsers.ts");
  const { normalizeXId } = await import("../../../src/lib/utils/xid.ts");
  const { resolveManageXIconUrl, verifyManageXIconSignatureInput } = await import("../../../src/lib/media/manageXIcon.ts");
  const { parseEventPartsJson } = await import("../../../src/lib/video/parseEventIds.ts");
  const { PRESET_PERMISSIONS, resolveStaffPermissionKeys } = await import("../src/routes/manage/access.ts");
  const order = await import("../src/routes/manage/eventOrder.ts");

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

  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));
  const stats = {};
  function record(endpoint, r) {
    (stats[endpoint] ??= []).push({ statements: r.stats.statements, batches: r.stats.batches, maxBinds: r.stats.maxBinds, bytes: r.bytes });
  }

  async function call(path, token, options = {}) {
    const d1 = options.d1 ?? createD1(options.sqlite ?? sqlite);
    const env = { DB: d1, AUTH_SECRET: "secret" in options ? options.secret : "test-secret" };
    const response = await app.request(path, { method: "GET", headers: token ? cookie(token) : {} }, env);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, stats: d1.stats, bytes: Buffer.byteLength(text) };
  }

  // ---------- CURRENT reference loaders ----------
  async function refSnapshot(name) {
    const id = `u_${name}`;
    const role = USERS[name];
    if (role === "admin") return MA.buildManageAuthorizationSnapshot(id, role, []);
    const rows = await refDb
      .select({
        event_id: S.eventStaff.event_id,
        x_user_id: S.eventStaff.x_user_id,
        permission_preset: S.eventStaff.permission_preset,
        custom_permission_keys_json: S.eventStaff.custom_permission_keys_json,
        active_x_user_id: S.users.active_x_user_id,
      })
      .from(S.eventStaff)
      .innerJoin(S.xUserAccountLinks, eq(S.xUserAccountLinks.x_user_id, S.eventStaff.x_user_id))
      .innerJoin(S.users, eq(S.users.id, S.xUserAccountLinks.auth_user_id))
      .innerJoin(S.xUsers, eq(S.xUsers.id, S.xUserAccountLinks.x_user_id))
      .where(and(eq(S.xUserAccountLinks.auth_user_id, id), eq(S.xUsers.approval_status, "approved")));
    return MA.buildManageAuthorizationSnapshot(id, role, rows);
  }

  const eventSelect = {
    id: S.events.id,
    title: S.events.title,
    accent_color: S.events.accent_color,
    visibility_status: S.events.visibility_status,
    start_time: S.events.start_time,
    end_time: S.events.end_time,
    entry_start_time: S.events.entry_start_time,
    entry_end_time: S.events.entry_end_time,
    created_at: S.events.created_at,
  };

  // src/lib/manage/navigationEvents.ts (loadManageNavigationSnapshot), one IN query instead of 80-id chunks.
  async function refNavigation(name) {
    const snapshot = await refSnapshot(name);
    const base = refDb.select(eventSelect).from(S.events);
    const rows = snapshot.isAdmin
      ? await base.orderBy(desc(S.events.start_time), desc(S.events.created_at), desc(S.events.id))
      : snapshot.manageableEventIds.length === 0
        ? []
        : await base
            .where(inArray(S.events.id, [...snapshot.manageableEventIds]))
            .orderBy(desc(S.events.start_time), desc(S.events.created_at), desc(S.events.id));
    const pendingBase = refDb
      .select({ event_id: S.videoEvents.event_id, c: sql`COUNT(*)` })
      .from(S.videos)
      .innerJoin(S.videoEvents, eq(S.videoEvents.video_id, S.videos.id));
    const pendingRows = snapshot.isAdmin
      ? await pendingBase.where(eq(S.videos.visibility_status, "pending")).groupBy(S.videoEvents.event_id)
      : rows.length === 0
        ? []
        : await pendingBase
            .where(and(inArray(S.videoEvents.event_id, rows.map((r) => r.id)), eq(S.videos.visibility_status, "pending")))
            .groupBy(S.videoEvents.event_id);
    const pendingByEvent = new Map(pendingRows.map((r) => [r.event_id, Number(r.c ?? 0)]));
    const toEvent = (row) => {
      const { created_at: _c, ...event } = row;
      return { ...event, pending_review_count: pendingByEvent.get(row.id) ?? 0 };
    };
    const events = rows.map(toEvent);
    return { snapshot, events, dashboardEvents: [...rows].sort(compareEventsByUpcomingPriority).map(toEvent), pendingByEvent };
  }

  // app/(manage)/manage/page.tsx
  async function refDashboard(name) {
    const nav = await refNavigation(name);
    const { snapshot } = nav;
    const user = (await refDb.select().from(S.users).where(eq(S.users.id, `u_${name}`)))[0];
    const eventIds = nav.dashboardEvents.map((e) => e.id);
    const inboxRows = eventIds.length
      ? await refDb.select().from(S.auditLogs).where(and(eq(S.auditLogs.table_name, "events"), inArray(S.auditLogs.target_id, eventIds))).orderBy(desc(S.auditLogs.created_at)).limit(20)
      : [];
    const notificationRows = eventIds.length
      ? await refDb.select().from(S.notificationOutbox).where(inArray(S.notificationOutbox.event_id, eventIds)).orderBy(desc(S.notificationOutbox.created_at)).limit(20)
      : [];
    const linked = await getHeaderLinkedXUsersForAuthUser(refDb, user.id);
    const active = await resolveActiveXUserId(refDb, user.id, normalizeXId(user.active_x_user_id) || null, linked);
    const isAdmin = snapshot.isAdmin;
    return {
      access: { isAdmin: snapshot.isAdmin, canAccessAdmin: snapshot.canAccessAdmin, canAccessManage: snapshot.canAccessManage, canManageXIdLinkRequests: snapshot.canManageXIdLinkRequests },
      activeXUserId: isAdmin ? null : active,
      manageStaffXUserIds: isAdmin ? [] : [...MA.getManageStaffXUserIdsFromSnapshot(snapshot)],
      events: nav.dashboardEvents.map((e) => ({ ...e, staff_role: isAdmin ? null : snapshot.roleByEvent.get(e.id) ?? null })),
      eventsTruncated: false,
      pendingReviewTotal: [...nav.pendingByEvent.values()].reduce((t, c) => t + c, 0),
      acceptingEventCount: nav.dashboardEvents.filter((e) => isAcceptingEntries(e)).length,
      failedNotificationCount: notificationRows.filter((n) => n.status === "failed").length,
      notificationSchemaMissing: false,
      notifications: notificationRows.map((n) => ({
        id: n.id, type: n.type, status: n.status, payload_json: n.payload_json, attempt_count: n.attempt_count,
        last_error: n.last_error, dedupe_key: n.dedupe_key, recipient_user_id: n.recipient_user_id, event_id: n.event_id, created_at: n.created_at,
      })),
      inbox: inboxRows.map((h) => ({ id: h.id, target_id: h.target_id, operation: h.operation, actor_user_id: h.actor_user_id, created_at: h.created_at })),
    };
  }

  // app/(manage)/manage/events/[id]/staff/page.tsx
  async function refStaff(name, eventId) {
    const nav = await refNavigation(name);
    const { snapshot } = nav;
    const event = nav.events.find((e) => e.id === eventId);
    if (!event) return 404;
    const permissions = snapshot.isAdmin ? new Set() : MA.getEventPermissionsFromSnapshot(snapshot, eventId);
    if (!snapshot.isAdmin && permissions.size === 0) return 404;
    const rows = await refDb
      .select({
        id: S.eventStaff.id, x_user_id: S.eventStaff.x_user_id, display_name: S.eventStaff.display_name,
        permission_preset: S.eventStaff.permission_preset, custom_permission_keys_json: S.eventStaff.custom_permission_keys_json,
        is_public: S.eventStaff.is_public, public_role_label: S.eventStaff.public_role_label, approved_at: S.eventStaff.approved_at,
        x_name: S.xUsers.x_name, icon_url: S.xUsers.icon_url, approval_status: S.xUsers.approval_status,
      })
      .from(S.eventStaff)
      .leftJoin(S.xUsers, eq(S.xUsers.id, S.eventStaff.x_user_id))
      .where(eq(S.eventStaff.event_id, eventId))
      .orderBy(asc(S.eventStaff.display_name), asc(S.eventStaff.id));
    const members = await Promise.all(
      rows.map(async (row) => ({
        id: row.id, x_user_id: row.x_user_id, display_name: row.display_name, permission_preset: row.permission_preset,
        is_public: row.is_public, public_role_label: row.public_role_label,
        permission_keys: Array.from(PR.resolveStaffPermissionKeys(row)),
        x_name: row.x_name,
        icon_url: await resolveManageXIconUrl({ iconUrl: row.icon_url, approvalStatus: row.approval_status, authSecret: "test-secret" }),
      })),
    );
    return {
      event: { id: event.id, title: event.title, accent_color: event.accent_color },
      isAdmin: snapshot.isAdmin,
      canManageMembers: snapshot.isAdmin || permissions.has("event.members"),
      pendingCount: nav.pendingByEvent.get(eventId) ?? 0,
      members,
      ownerCount: rows.filter((r) => r.permission_preset === "owner").length,
      publicCount: rows.filter((r) => r.is_public === 1).length,
      approvedCount: rows.filter((r) => r.approval_status === "approved").length,
      membersTruncated: false,
    };
  }

  // app/(manage)/manage/events/[id]/slots/page.tsx (limit 500; the API serves it in pages of 100)
  async function refSlots(name, eventId, statusFilter = "all", offset = 0) {
    const snapshot = await refSnapshot(name);
    const event = (await refDb.select({ id: S.events.id, title: S.events.title, accent_color: S.events.accent_color, slot_part_gap_minutes: S.events.slot_part_gap_minutes, parts_json: S.events.parts_json }).from(S.events).where(eq(S.events.id, eventId)).limit(1))[0];
    if (!event) return 404;
    if (!MA.canEditEventFromSnapshot(snapshot, eventId, "event.slots")) return 404;
    const where = statusFilter === "all" ? eq(S.slots.event_id, eventId) : and(eq(S.slots.event_id, eventId), eq(S.slots.status, statusFilter));
    const rows = await refDb
      .select({
        id: S.slots.id, event_id: S.slots.event_id, slot_label: S.slots.slot_label, start_time: S.slots.start_time, sort_order: S.slots.sort_order,
        status: S.slots.status, display_name: S.slots.display_name, x_user_id: S.slots.x_user_id, reserved_x_id_snapshot: S.slots.reserved_x_id_snapshot,
        reserved_by_user_id: S.slots.reserved_by_user_id, discord_display_name: S.users.name, discord_id: S.users.discord_id,
        reservation_group_id: S.slots.reservation_group_id, video_id: S.slots.video_id, updated_at: S.slots.updated_at, version: S.slots.version,
      })
      .from(S.slots)
      .leftJoin(S.users, eq(S.slots.reserved_by_user_id, S.users.id))
      .where(where)
      .orderBy(asc(S.slots.start_time), asc(S.slots.sort_order), asc(S.slots.id))
      .limit(500);
    const countRows = await refDb.select({ status: S.slots.status, count: sql`COUNT(*)` }).from(S.slots).where(eq(S.slots.event_id, eventId)).groupBy(S.slots.status);
    const counts = Object.fromEntries(countRows.map((r) => [r.status, Number(r.count ?? 0)]));
    const nav = await refNavigation(name);
    return {
      event: { id: event.id, title: event.title, accent_color: event.accent_color, slot_part_gap_minutes: event.slot_part_gap_minutes, parts: parseEventPartsJson(event.parts_json) },
      isAdmin: snapshot.isAdmin,
      statusFilter,
      offset,
      pageSize: 100,
      pendingCount: nav.pendingByEvent.get(eventId) ?? 0,
      total: Object.values(counts).reduce((s, c) => s + c, 0),
      counts,
      slots: rows.slice(offset, offset + 100),
    };
  }

  const WITH_ACCESS = ["admin", "owner", "mgr", "rev", "slot", "custom", "two", "outsider", "many"];
  const NO_ACCESS = ["removed", "pending", "plain", "pubstaff"];

  // ---------------- permissions ----------------
  test("T-perm: preset table, key resolution and snapshot equal CURRENT for every staff row shape", async () => {
    for (const [preset, def] of Object.entries(PRESET_DEFINITIONS)) {
      assert.deepEqual([...PRESET_PERMISSIONS[preset]], [...def.permissions], preset);
    }
    assert.deepEqual(Object.keys(PRESET_PERMISSIONS).sort(), Object.keys(PRESET_DEFINITIONS).sort());
    const rows = [
      { permission_preset: "owner" }, { permission_preset: "manager" }, { permission_preset: "public_staff" }, { permission_preset: "bogus" },
      { permission_preset: null }, { permission_preset: "toString" },
      { permission_preset: "custom", custom_permission_keys_json: JSON.stringify(["videos.title", "xid.link_requests", "event.slots", 7, "nope", "video.chapter_admin"]) },
      { permission_preset: "custom", custom_permission_keys_json: "{bad" }, { permission_preset: "custom", custom_permission_keys_json: "{}" }, { permission_preset: "custom", custom_permission_keys_json: null },
    ];
    for (const row of rows) assert.deepEqual([...resolveStaffPermissionKeys(row)], [...PR.resolveStaffPermissionKeys(row)], JSON.stringify(row));
  });

  test("T-order: status, accepting-entries and ordering helpers equal CURRENT", () => {
    const stamps = [null, NOW - 100, NOW + 100, NOW - 86400 * 9, NOW + 86400 * 9];
    const events = [];
    for (const visibility_status of ["public", "private", null, "archived"]) {
      for (const start_time of stamps) {
        for (const end_time of stamps) {
          for (const entry of [[null, null], [NOW - 5, null], [null, NOW - 5], [NOW - 5, NOW + 5], [NOW + 5, NOW + 9]]) {
            events.push({ id: `e${events.length}`, visibility_status, start_time, end_time, entry_start_time: entry[0], entry_end_time: entry[1] });
          }
        }
      }
    }
    for (const ev of events) {
      assert.equal(order.computeEventStatus(ev, NOW), computeEventStatus(ev, NOW));
      assert.equal(order.isAcceptingEntries(ev, NOW), isAcceptingEntries(ev, NOW));
    }
    const sample = events.filter((_, i) => i % 7 === 0).slice(0, 60);
    for (const a of sample) for (const b of sample) assert.equal(order.compareEventsByUpcomingPriority(a, b, NOW), compareEventsByUpcomingPriority(a, b, NOW));
  });

  // ---------------- navigation ----------------
  test("T-nav: events, pending counts and access equal CURRENT for every user", async () => {
    for (const name of WITH_ACCESS) {
      const r = await call("/api/manage/navigation", `tok-${name}`);
      assert.equal(r.status, 200, name);
      const ref = await refNavigation(name);
      const events = ref.events.slice(0, 100);
      assert.deepEqual(r.body.events, canon(events), name);
      assert.equal(r.body.truncated, ref.events.length > 100 || name === "many", name);
      assert.deepEqual(r.body.access, canon({ isAdmin: ref.snapshot.isAdmin, canAccessAdmin: ref.snapshot.canAccessAdmin, canAccessManage: ref.snapshot.canAccessManage, canManageXIdLinkRequests: ref.snapshot.canManageXIdLinkRequests }), name);
      record("navigation", r);
    }
  });

  // ---------------- dashboard ----------------
  test("T-dash: dashboard (events by priority, KPIs, inbox, notifications, active X) equals CURRENT", async () => {
    for (const name of WITH_ACCESS.filter((n) => n !== "many")) {
      const r = await call("/api/manage", `tok-${name}`);
      assert.equal(r.status, 200, name);
      const ref = await refDashboard(name);
      if (name === "admin") continue; // CURRENT lists every event; the API caps at 100 (see the admin test below)
      assert.deepEqual(r.body, canon(ref), name);
      record("dashboard", r);
    }
  });

  test("T-dash admin: first 100 events by the same priority order, full inbox/notifications", async () => {
    const r = await call("/api/manage", "tok-admin");
    const ref = await refDashboard("admin");
    assert.equal(r.body.events.length, 100);
    assert.equal(r.body.eventsTruncated, true);
    assert.deepEqual(r.body.inbox, canon(ref.inbox));
    assert.deepEqual(r.body.notifications, canon(ref.notifications));
    assert.deepEqual(r.body.access, canon(ref.access));
    const refIds = new Set(ref.events.map((e) => e.id));
    assert.ok(r.body.events.every((e) => refIds.has(e.id)));
    record("dashboard", r);
  });

  test("T-dash: active X is resolved against approved links (CURRENT resolveActiveXUserId), unset for admin", async () => {
    assert.equal((await call("/api/manage", "tok-two")).body.activeXUserId, "two_x1", "legacy ' TWO_X1 ' -> canonical id");
    assert.equal((await call("/api/manage", "tok-owner")).body.activeXUserId, "owner_x", "unlinked active X -> the sole approved X");
    assert.equal((await call("/api/manage", "tok-admin")).body.activeXUserId, null);
  });

  test("T-dash: notifications expose only rendered columns (no lease token) and are scoped to the caller's events", async () => {
    const owner = (await call("/api/manage", "tok-owner")).body;
    assert.ok(owner.notifications.length > 0);
    assert.ok(owner.notifications.every((n) => !("lease_token" in n) && ["evA"].includes(n.event_id)));
    assert.ok(owner.inbox.every((h) => h.target_id === "evA" || h.target_id === "evD"));
    const outsider = (await call("/api/manage", "tok-outsider")).body;
    assert.ok(outsider.notifications.every((n) => n.event_id === "evC"));
    assert.ok(outsider.inbox.every((h) => h.target_id === "evC"));
  });

  test("T-dash: missing notification_outbox.event_id degrades like CURRENT (warning flag, empty list, 200)", async () => {
    const old = createSqlite();
    seed(old);
    old.exec("DROP INDEX IF EXISTS notification_outbox_event_idx");
    old.exec("ALTER TABLE notification_outbox DROP COLUMN event_id");
    const r = await call("/api/manage", "tok-owner", { sqlite: old });
    assert.equal(r.status, 200);
    assert.equal(r.body.notificationSchemaMissing, true);
    assert.deepEqual(r.body.notifications, []);
    assert.equal(r.body.failedNotificationCount, 0);
    assert.ok(r.body.events.length > 0 && r.body.inbox.length > 0);
    assert.equal(r.stats.statements, 4, "session + staff + failed data + retry data");
  });

  // ---------------- staff ----------------
  test("T-staff: staff page equals CURRENT for every user and event", async () => {
    for (const name of WITH_ACCESS.filter((n) => n !== "many")) {
      for (const eventId of ["evA", "evB", "evC", "evD", "evNull", "evTie1", "evTie2", "missingEvent", "nope"]) {
        const r = await call(`/api/manage/events/${eventId}/staff`, `tok-${name}`);
        const ref = await refStaff(name, eventId);
        if (ref === 404) {
          assert.equal(r.status, 404, `${name} ${eventId}`);
          assert.equal(r.headers.get("cache-control"), "private, no-store");
          continue;
        }
        assert.equal(r.status, 200, `${name} ${eventId}`);
        assert.deepEqual(r.body, canon(ref), `${name} ${eventId}`);
        record("staff", r);
      }
    }
  });

  test("T-staff: owner-0 event, read-only reviewers, icon rules", async () => {
    const admin = (await call("/api/manage/events/evB/staff", "tok-admin")).body;
    assert.equal(admin.ownerCount, 0, "evB has no owner row");
    assert.equal(admin.canManageMembers, true);
    assert.equal((await call("/api/manage/events/evTie2/staff", "tok-admin")).body.members.length, 0);
    const rev = (await call("/api/manage/events/evA/staff", "tok-rev")).body;
    assert.equal(rev.canManageMembers, false, "reviewer lacks event.members");
    assert.equal(rev.ownerCount, 5, "owner presets are counted for every staff row, including unlinked or unapproved X");
    const owner = (await call("/api/manage/events/evA/staff", "tok-owner")).body;
    assert.equal(owner.canManageMembers, true);
    const icons = Object.fromEntries(owner.members.map((m) => [m.x_user_id, m.icon_url]));
    assert.equal(icons.owner_x, "https://x.test/o.png", "external https icons are unchanged");
    assert.match(icons.mgr_x, /^\/api\/media\/manage-x-icon\/xicons\/mgr\.png\?v=1&exp=\d+&sig=[\w-]+$/, "internal icons are signed");
    const url = new URL(icons.mgr_x, "https://x.test");
    assert.equal(
      await verifyManageXIconSignatureInput({ key: "xicons/mgr.png", expiresAt: Number(url.searchParams.get("exp")), signature: url.searchParams.get("sig"), secret: "test-secret" }),
      true,
      "CURRENT verifies the API signature",
    );
    const noSecret = (await call("/api/manage/events/evA/staff", "tok-owner", { secret: undefined })).body;
    assert.equal(noSecret.members.find((m) => m.x_user_id === "mgr_x").icon_url, null, "no AUTH_SECRET -> no unsigned internal URL (CURRENT)");
    assert.equal(noSecret.members.find((m) => m.x_user_id === "owner_x").icon_url, "https://x.test/o.png");
  });

  // ---------------- slots ----------------
  test("T-slots: slots page equals CURRENT for every user, filter and page", async () => {
    for (const name of WITH_ACCESS.filter((n) => n !== "many")) {
      for (const eventId of ["evA", "evB", "evC", "nope"]) {
        for (const [status, offset] of [["all", 0], ["all", 100], ["reserved", 0], ["available", 0], ["submitted", 100], ["bogus", 0]]) {
          const r = await call(`/api/manage/events/${eventId}/slots?status=${status}&offset=${offset}`, `tok-${name}`);
          const ref = await refSlots(name, eventId, ["available", "reserved", "submitted"].includes(status) ? status : "all", offset);
          if (ref === 404) {
            assert.equal(r.status, 404, `${name} ${eventId}`);
            continue;
          }
          assert.equal(r.status, 200, `${name} ${eventId} ${status}`);
          assert.deepEqual(r.body, canon(ref), `${name} ${eventId} ${status} ${offset}`);
          record("slots", r);
        }
      }
    }
  });

  test("T-slots: page size 100, offset clamp 0..400, rows beyond the first page are reachable", async () => {
    const first = (await call("/api/manage/events/evA/slots", "tok-owner")).body;
    assert.equal(first.slots.length, 100);
    assert.equal(first.total, 130);
    const second = (await call("/api/manage/events/evA/slots?offset=100", "tok-owner")).body;
    assert.equal(second.slots.length, 30);
    assert.equal(new Set([...first.slots, ...second.slots].map((s) => s.id)).size, 130);
    assert.equal((await call("/api/manage/events/evA/slots?offset=99999", "tok-owner")).body.offset, 400);
    assert.equal((await call("/api/manage/events/evA/slots?offset=-5", "tok-owner")).body.offset, 0);
    assert.equal((await call("/api/manage/events/evA/slots?offset=abc", "tok-owner")).body.offset, 0);
  });

  // ---------------- authorization / IDOR ----------------
  test("T-auth: unauthenticated -> 401, banned -> 403, no manage access -> 403 manage_access_required", async () => {
    const paths = ["/api/manage", "/api/manage/navigation", "/api/manage/events/evA/staff", "/api/manage/events/evA/slots"];
    for (const path of paths) {
      assert.equal((await call(path, null)).status, 401, path);
      assert.equal((await call(path, "tok-expired")).status, 401, path);
      assert.equal((await call(path, "tok-nope")).status, 401, path);
      const banned = await call(path, "tok-banned");
      assert.equal(banned.status, 403, path);
      assert.equal(banned.body.message, "User is banned");
      for (const name of NO_ACCESS) {
        const r = await call(path, `tok-${name}`);
        assert.equal(r.status, 403, `${name} ${path}`);
        assert.deepEqual(r.body, { error: "Forbidden", reason: "manage_access_required" });
        assert.equal(r.headers.get("cache-control"), "private, no-store");
      }
    }
  });

  test("T-idor: staff of event A cannot read event B/C; removed staff lose access immediately", async () => {
    assert.equal((await call("/api/manage/events/evC/staff", "tok-owner")).status, 404);
    assert.equal((await call("/api/manage/events/evC/slots", "tok-owner")).status, 404);
    assert.equal((await call("/api/manage/events/evA/staff", "tok-outsider")).status, 404);
    assert.equal((await call("/api/manage/events/evA/slots", "tok-outsider")).status, 404);
    assert.equal((await call("/api/manage/events/evB/slots", "tok-mgr")).status, 404, "reviewer on evB has no event.slots");
    assert.equal((await call("/api/manage/events/evB/staff", "tok-mgr")).status, 200, "any permission lets the read-only staff list open");
    assert.equal((await call("/api/manage/events/evA/slots", "tok-rev")).status, 404, "reviewer lacks event.slots on evA");
    assert.equal((await call("/api/manage/events/evA/slots", "tok-custom")).status, 404, "custom keys do not include event.slots");
    assert.equal((await call("/api/manage/events/evB/slots", "tok-slot")).status, 200);
    assert.equal((await call("/api/manage/events/evA/slots", "tok-slot")).status, 404);
    const nav = (await call("/api/manage/navigation", "tok-owner")).body;
    assert.ok(nav.events.every((e) => ["evA", "evD"].includes(e.id)), "navigation lists only the caller's events");
    assert.equal((await call("/api/manage/navigation", "tok-outsider")).body.events.length, 1);
    // removal takes effect on the next request
    const row = sqlite.prepare("SELECT * FROM event_staff WHERE event_id = 'evC' AND x_user_id = 'outsider_x'").get();
    sqlite.prepare("DELETE FROM event_staff WHERE id = ?").run(row.id);
    try {
      assert.equal((await call("/api/manage/events/evC/staff", "tok-outsider")).status, 403);
      assert.equal((await call("/api/manage/navigation", "tok-outsider")).status, 403);
    } finally {
      const keys = Object.keys(row);
      sqlite.prepare(`INSERT INTO event_staff (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k]));
    }
    assert.equal((await call("/api/manage/events/evC/staff", "tok-outsider")).status, 200);
    // unapproved X: the staff row alone grants nothing; approval turns it on
    sqlite.prepare("UPDATE x_users SET approval_status = 'approved' WHERE id = 'pending_x'").run();
    try {
      assert.equal((await call("/api/manage/navigation", "tok-pending")).status, 200);
    } finally {
      sqlite.prepare("UPDATE x_users SET approval_status = 'pending' WHERE id = 'pending_x'").run();
    }
    assert.equal((await call("/api/manage/navigation", "tok-pending")).status, 403);
  });

  test("T-auth: staff of an event that no longer exists passes the layout gate and sees an empty list (CURRENT)", async () => {
    const dash = await call("/api/manage", "tok-ghost");
    assert.equal(dash.status, 200);
    assert.deepEqual(dash.body.events, []);
    assert.equal((await call("/api/manage/events/missingEvent/staff", "tok-ghost")).status, 404);
  });

  test("T-idor: ids are bound, not interpolated (injection-shaped ids are plain 404s)", async () => {
    for (const id of ["evA'%20OR%201=1--", "%25", "evA%00", "..%2FevA"]) {
      for (const tail of ["staff", "slots"]) {
        const r = await call(`/api/manage/events/${id}/${tail}`, "tok-admin");
        assert.equal(r.status, 404, `${id} ${tail}`);
      }
    }
  });

  // ---------------- contract: read-only, no-store, budgets ----------------
  test("T-contract: GET only, no D1 writes, no cookies, private no-store, <= 3 statements, <= 100 binds, <= 64KiB", async () => {
    const paths = ["/api/manage", "/api/manage/navigation", "/api/manage/events/evA/staff", "/api/manage/events/evA/slots"];
    for (const name of ["admin", "owner", "two", "many"]) {
      for (const path of paths) {
        const r = await call(path, `tok-${name}`);
        assert.ok([200, 404].includes(r.status), `${name} ${path}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.equal(r.headers.get("set-cookie"), null);
        assert.equal(r.stats.writes, 0);
        assert.equal(r.stats.batches, 0);
        assert.ok(r.stats.statements <= (name === "admin" ? 2 : 2) + 1, `${name} ${path} statements=${r.stats.statements}`);
        assert.ok(r.stats.maxBinds <= 100, `${name} ${path}`);
        assert.ok(r.bytes <= 64 * 1024, `${name} ${path} bytes=${r.bytes}`);
      }
    }
    const adminNav = await call("/api/manage/navigation", "tok-admin");
    assert.equal(adminNav.stats.statements, 2, "session + events (admins skip the staff read)");
    const ownerNav = await call("/api/manage/navigation", "tok-owner");
    assert.equal(ownerNav.stats.statements, 3, "session + staff + events");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/api/manage", { method, headers: cookie("tok-admin") }, { DB: createD1(sqlite) });
      assert.equal(res.status, 404, method);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM audit_logs").get().c, 26, "nothing was written");
  });

  test("T-contract: D1 failure -> 503 with fixed body, no-store, no query text leaked", async () => {
    const d1 = createD1(sqlite);
    const prepare = d1.prepare;
    d1.prepare = (text) => {
      if (/event_staff/.test(text)) throw new Error("boom: SELECT secret FROM event_staff");
      return prepare(text);
    };
    const r = await call("/api/manage/navigation", "tok-owner", { d1 });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: "unavailable" });
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  });

  test("T-contract: more than 100 staff rows is flagged as truncated", async () => {
    const r = await call("/api/manage/navigation", "tok-many");
    assert.equal(r.body.truncated, true);
    assert.equal(r.body.events.length, 100);
  });

  test("statement-count summary (informational)", () => {
    const summary = Object.fromEntries(
      Object.entries(stats).map(([endpoint, list]) => [
        endpoint,
        { max_statements: Math.max(0, ...list.map((s) => s.statements)), max_binds: Math.max(0, ...list.map((s) => s.maxBinds)), max_bytes: Math.max(0, ...list.map((s) => s.bytes)) },
      ]),
    );
    console.log("[MIG-0624] D1 usage per request", JSON.stringify(summary));
    assert.ok(Object.values(summary).every((s) => s.max_statements <= 3 && s.max_binds <= 100 && s.max_bytes <= 64 * 1024));
  });
}

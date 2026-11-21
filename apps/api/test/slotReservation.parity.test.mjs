// MIG-0657 (SA-065..068): real CURRENT Server Actions (src/lib/actions/slot.ts) vs Hono
// on the same migrated SQLite schema. Only Next/router/auth host ports are replaced;
// DB, audit, outbox, queue, domain and server-core stay real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite, insert } from "./support/personalHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  const stubs = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath() {}",
    "next/navigation": "export function unstable_rethrow() {} export function redirect() {} export function notFound() {}",
    "@/lib/auth/writeGuard": "export async function writeGuard(o) { return globalThis.__slotGuard(o); }",
    "@/lib/serverCore/nextPorts":
      "export const nextQueueWakeHost = { readEnv: () => globalThis.__wakeEnv(), readWaitUntil: () => null, readKv: () => null };",
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier in stubs) {
        return {
          url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const { atomicD1, seedChapterWorld, SITE, SESSION_USER, ROLES, ACTIVE } = await import("./support/chapterSeed.mjs");
  const { Hono } = await import("hono");
  const { app } = await import("../src/app.ts");
  const { createSlotReservationRoutes } = await import("../src/routes/events/slotReservation.ts");
  const current = await import("../../../src/lib/actions/slot.ts");
  const { QUEUE_BINDING_NAMES, QUEUE_FEATURE_FLAG_NAMES } = await import(
    "../../../packages/server-core/src/queues/wakeBudget.ts"
  );
  const { SlotMutationResultSchema } = await import("@flamenode/contracts");
  process.env.NEXT_PUBLIC_SITE_URL = SITE;

  const NOW_SEC = 1800000000;

  function seedSlotWorld(sqlite) {
    seedChapterWorld(sqlite);
    // Add a rejected active X user and a second approved X user for u_multi tests.
    insert(sqlite, "x_users", { id: "x_rej", x_name: "Rejected", approval_status: "rejected" });
    insert(sqlite, "user", {
      id: "u_rej",
      name: "u_rej",
      discord_id: "d_u_rej",
      role: "user",
      is_banned: 0,
      is_tos_accepted: 1,
      active_x_user_id: "x_rej",
    });
    insert(sqlite, "user", {
      id: "u_notos",
      name: "u_notos",
      discord_id: "d_u_notos",
      role: "user",
      is_banned: 0,
      is_tos_accepted: 0,
      active_x_user_id: null,
    });
    // Pending X request for u_pend (no approved links, 1 pending request x_pend).
    insert(sqlite, "x_identity_requests", {
      id: "xreq_pend_1",
      request_type: "new_link",
      requested_by_auth_user_id: "u_pend",
      requested_x_id: "x_pend",
      status: "pending",
      requested_at: 100,
      updated_at: 100,
    });

    // Public accepting-entries event with max_slots_per_video = 4, gap = 15 min.
    sqlite
      .prepare(
        `UPDATE events SET
          visibility_status = 'public',
          start_time = ?, end_time = ?,
          entry_start_time = ?, entry_end_time = ?,
          max_slots_per_video = 4,
          max_slot_reservation_groups_per_xid = 0,
          slot_part_gap_minutes = 15
        WHERE id = 'ev1'`,
      )
      .run(NOW_SEC + 1000, NOW_SEC + 10000, NOW_SEC - 1000, NOW_SEC + 5000);

    // Pre-entry public event (operator override allowed for slot_manager/admin, denied for regular users).
    sqlite
      .prepare(
        `UPDATE events SET
          visibility_status = 'public',
          start_time = ?, end_time = ?,
          entry_start_time = ?, entry_end_time = ?,
          max_slots_per_video = 3,
          max_slot_reservation_groups_per_xid = 1,
          slot_part_gap_minutes = 15
        WHERE id = 'ev2'`,
      )
      .run(NOW_SEC + 5000, NOW_SEC + 10000, NOW_SEC + 1000, NOW_SEC + 4000);
    insert(sqlite, "event_staff", {
      id: "staff_ev2_slot",
      event_id: "ev2",
      x_user_id: "x_staff",
      display_name: "Ev2 Slot Mgr",
      permission_preset: "slot_manager",
    });

    // Limited event for X ID reservation cap (max 1 group per X ID, max 2 slots per video).
    insert(sqlite, "events", {
      id: "ev_limit",
      title: "Limited Event",
      visibility_status: "public",
      start_time: NOW_SEC + 1000,
      end_time: NOW_SEC + 10000,
      entry_start_time: NOW_SEC - 1000,
      entry_end_time: NOW_SEC + 5000,
      max_slots_per_video: 2,
      max_slot_reservation_groups_per_xid: 1,
      slot_part_gap_minutes: 15,
    });

    // Closed event (ended) for operator override boundary rejection.
    insert(sqlite, "events", {
      id: "ev_closed",
      title: "Closed Event",
      visibility_status: "public",
      start_time: NOW_SEC - 5000,
      end_time: NOW_SEC - 1000,
      entry_start_time: NOW_SEC - 6000,
      entry_end_time: NOW_SEC - 2000,
      max_slots_per_video: 4,
      max_slot_reservation_groups_per_xid: 0,
      slot_part_gap_minutes: 15,
    });
    insert(sqlite, "event_staff", {
      id: "staff_closed_slot",
      event_id: "ev_closed",
      x_user_id: "x_staff",
      display_name: "Closed Slot Mgr",
      permission_preset: "slot_manager",
    });

    // 25 contiguous slots in ev1 (part 1: s01..s22 @ +600s each; part 2: s23..s25 @ +3600s later).
    for (let i = 1; i <= 25; i += 1) {
      const id = `s${String(i).padStart(2, "0")}`;
      const startTime = i <= 22 ? NOW_SEC + 1000 + i * 600 : NOW_SEC + 30000 + i * 600;
      insert(sqlite, "slots", {
        id,
        event_id: "ev1",
        slot_label: `Slot ${i}`,
        start_time: startTime,
        sort_order: i,
        status: "available",
        updated_at: 100,
        version: 1,
      });
    }
    // Pre-existing submitted slot in ev1 (after part 2).
    insert(sqlite, "slots", {
      id: "s_sub",
      event_id: "ev1",
      reserved_by_user_id: "u_owner",
      x_user_id: "x_owner",
      reserved_x_id_snapshot: "x_owner",
      display_name: "Submitted",
      slot_label: "Slot Sub",
      start_time: NOW_SEC + 50000,
      sort_order: 26,
      status: "submitted",
      video_id: "v_pub",
      updated_at: 100,
      version: 1,
    });
    // Pre-existing Discord-only reserved slot group (x_user_id = null) for adoption test.
    insert(sqlite, "slots", {
      id: "s_un1",
      event_id: "ev1",
      reserved_by_user_id: "u_owner",
      x_user_id: null,
      reserved_x_id_snapshot: null,
      display_name: "Unassigned",
      slot_label: "Slot U1",
      start_time: NOW_SEC + 60000,
      sort_order: 27,
      reservation_group_id: "grp_unassigned",
      status: "reserved",
      updated_at: 100,
      version: 1,
    });
    insert(sqlite, "slots", {
      id: "s_un2",
      event_id: "ev1",
      slot_label: "Slot U2",
      start_time: NOW_SEC + 60600,
      sort_order: 28,
      status: "available",
      updated_at: 100,
      version: 1,
    });

    // Slots in ev2, ev_limit, ev_closed.
    for (let i = 1; i <= 4; i += 1) {
      insert(sqlite, "slots", {
        id: `lim_${i}`,
        event_id: "ev_limit",
        slot_label: `Lim ${i}`,
        start_time: NOW_SEC + 1000 + i * 600,
        sort_order: i,
        status: "available",
        updated_at: 100,
        version: 1,
      });
      insert(sqlite, "slots", {
        id: `ev2_${i}`,
        event_id: "ev2",
        slot_label: `Ev2 ${i}`,
        start_time: NOW_SEC + 5000 + i * 600,
        sort_order: i,
        status: "available",
        updated_at: 100,
        version: 1,
      });
    }
    insert(sqlite, "slots", {
      id: "closed_1",
      event_id: "ev_closed",
      slot_label: "Closed 1",
      start_time: NOW_SEC - 4000,
      sort_order: 1,
      status: "available",
      updated_at: 100,
      version: 1,
    });
  }

  function world(options) {
    const sqlite = createSqlite();
    seedSlotWorld(sqlite);
    return { sqlite, d1: atomicD1(sqlite, options) };
  }

  const freeze = (initialId = 0) => {
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    let n = initialId;
    Date.now = () => NOW_SEC * 1000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  };

  function state(w) {
    return {
      slots: w.sqlite.prepare("SELECT * FROM slots ORDER BY id").all(),
      outbox: w.sqlite.prepare("SELECT * FROM notification_outbox ORDER BY id").all(),
      queue: w.sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all(),
      audits: w.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
    };
  }

  const quiet = async (fn) => {
    const original = { warn: console.warn, log: console.log, info: console.info, error: console.error };
    console.warn = () => {};
    console.log = () => {};
    console.info = () => {};
    console.error = () => {};
    try {
      return await fn();
    } finally {
      Object.assign(console, original);
    }
  };

  async function runCurrent(w, user, op, args) {
    const row = w.sqlite.prepare("SELECT id, name, role, active_x_user_id FROM user WHERE id = ?").get(user);
    const approvedRows = w.sqlite
      .prepare(
        `SELECT l.x_user_id FROM x_user_account_links l
         INNER JOIN x_users x ON x.id = l.x_user_id
         WHERE l.auth_user_id = ? AND x.approval_status = 'approved'`,
      )
      .all(user);
    const approvedXIds = approvedRows.map((r) => r.x_user_id);
    const wakes = [];
    globalThis.__wakeEnv = () => ({
      [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
      [QUEUE_BINDING_NAMES.notificationWake]: {
        send: async (payload) => {
          wakes.push({ kind: "notification", payload });
        },
      },
      [QUEUE_BINDING_NAMES.staticRebuildWake]: {
        send: async (payload) => {
          wakes.push({ kind: "static_rebuild", payload });
        },
      },
    });
    globalThis.__slotGuard = async (opts) => {
      const expectedFeature =
        op === "reserve"
          ? "reserve_slot"
          : op === "release"
            ? "release_slot"
            : op === "extend"
              ? "extend_slot_group"
              : "merge_slot_groups";
      assert.equal(opts.feature, expectedFeature);
      return {
        ok: true,
        db: drizzle(w.d1),
        user: {
          id: row.id,
          name: row.name,
          role: row.role,
          active_x_user_id: row.active_x_user_id,
        },
        activeXId: row.active_x_user_id,
        approvedXIds,
        hasPendingXRequest: false,
      };
    };
    const form = new FormData();
    let action;
    if (op === "reserve") {
      action = current.reserveSlot;
      form.set("slot_id", args.slot_id);
      form.set("display_name", args.display_name);
      if (args.consecutive_count !== undefined) form.set("consecutive_count", String(args.consecutive_count));
      if (args.operator_override !== undefined) form.set("operator_override", String(args.operator_override));
    } else if (op === "release") {
      action = current.releaseOwnSlot;
      form.set("slot_id", args.slot_id);
    } else if (op === "extend") {
      action = current.extendOwnSlotGroup;
      form.set("slot_id", args.slot_id);
      form.set("direction", args.direction);
      if (args.operator_override !== undefined) form.set("operator_override", String(args.operator_override));
    } else {
      action = current.mergeOwnSlotGroups;
      form.set("gap_slot_id", args.gap_slot_id);
      form.set("display_name", args.display_name);
      if (args.operator_override !== undefined) form.set("operator_override", String(args.operator_override));
    }
    const result = await quiet(() => action(form));
    return { result: JSON.parse(JSON.stringify(result)), wakes };
  }

  function honoApp(w, user, { banned = false, envExtra = {} } = {}) {
    const sessionUser = user
      ? {
          ...SESSION_USER(user, ROLES[user] ?? "user", user === "u_rej" ? "x_rej" : (ACTIVE[user] ?? null)),
          is_banned: banned ? 1 : 0,
        }
      : null;
    const hono = new Hono();
    hono.route(
      "/api/events",
      createSlotReservationRoutes({
        session: async (c, next) => {
          c.set("user", sessionUser);
          c.set("sessionState", sessionUser ? "user" : "none");
          await next();
        },
      }),
    );
    return (path, body, headers = { Origin: SITE }, raw) =>
      hono.request(
        path,
        {
          method: "POST",
          headers: raw === undefined && body === undefined ? headers : { "content-type": "application/json", ...headers },
          body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
        },
        { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE, ...envExtra },
      );
  }

  async function runHono(w, user, op, args, opts = {}) {
    const wakes = [];
    const call = honoApp(w, user, {
      ...opts,
      envExtra: {
        [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
        [QUEUE_BINDING_NAMES.notificationWake]: {
          send: async (p) => {
            wakes.push(p);
          },
        },
        [QUEUE_BINDING_NAMES.staticRebuildWake]: {
          send: async (p) => {
            wakes.push(p);
          },
        },
        ...(opts.envExtra ?? {}),
      },
    });
    const eventId = args.eventId ?? "ev1";
    let res;
    if (op === "reserve") {
      const { slot_id, eventId: _e, ...body } = args;
      res = await call(`/api/events/${eventId}/slots/${slot_id}/reserve`, body);
    } else if (op === "release") {
      res = await call(`/api/events/${eventId}/slots/${args.slot_id}/release`, args.body);
    } else if (op === "extend") {
      const { slot_id, eventId: _e, ...body } = args;
      res = await call(`/api/events/${eventId}/slots/${slot_id}/extend`, body);
    } else {
      const { eventId: _e, ...body } = args;
      res = await call(`/api/events/${eventId}/slot-groups/merge`, body);
    }
    return { status: res.status, result: await res.json(), wakes, cacheControl: res.headers.get("cache-control") };
  }

  async function compareSteps(steps) {
    const a = world();
    const b = world();
    const outcomes = [];
    for (const [user, op, args, expectedStatus] of steps) {
      const readsBefore = b.d1.stats.reads;
      const batchesBefore = b.d1.stats.batches;
      const thawA = freeze(outcomes.length * 100);
      let expected;
      try {
        expected = await runCurrent(a, user, op, args);
      } finally {
        thawA();
      }
      const thawB = freeze(outcomes.length * 100);
      let actual;
      try {
        actual = await runHono(b, user, op, args);
      } finally {
        thawB();
      }
      assert.deepEqual(actual.result, expected.result, `result ${user} ${op} ${JSON.stringify(args)}`);
      assert.deepEqual(state(b), state(a), `database ${user} ${op} ${JSON.stringify(args)}`);
      assert.equal(actual.status, expectedStatus, `status ${user} ${op} ${JSON.stringify(args)}`);
      assert.equal(actual.cacheControl, "private, no-store");
      assert.equal(SlotMutationResultSchema.safeParse(actual.result).success, true);
      assert.equal(actual.wakes.length, 0, "D-13-41: Hono sends 0 queue wakes");
      assert.ok(
        b.d1.stats.reads - readsBefore <= 3,
        `S3 D1 pre-read budget (<=3 incl. 2 guards): got ${b.d1.stats.reads - readsBefore} for ${op}`,
      );
      if (expectedStatus === 200) {
        assert.ok(b.d1.stats.batches - batchesBefore <= 1, "at most 1 atomic D1 batch");
      }
      outcomes.push({ expected, actual });
    }
    return { a, b, outcomes };
  }

  function afterFirstRead(w, matches, after) {
    let fired = false;
    const prepare = w.d1.prepare.bind(w.d1);
    w.d1.prepare = (sql) => {
      const stmt = prepare(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values) => {
        const bound = bind(...values);
        const first = bound.first.bind(bound);
        bound.first = async () => {
          const row = await first();
          if (!fired && matches(sql)) {
            fired = true;
            after(w.sqlite);
          }
          return row;
        };
        return bound;
      };
      return stmt;
    };
    return () => fired;
  }


  // SEC #716: inspecting the raw first D1 projection is mandatory. Validating
  // only the eventual HTTP body misses unbounded SQL JSON materialization.
  function watchReserveFirstD1Row(w, inspect) {
    let calls = 0;
    const prepare = w.d1.prepare.bind(w.d1);
    w.d1.prepare = (sql) => {
      const stmt = prepare(sql);
      if (!sql.includes("AS actor_json") || !sql.includes("AS approved_x_json")) return stmt;
      assert.match(sql, /length\(CAST\(q\."x_user_id" AS BLOB\)\)/,
        "shared approved-X JSON needs full-byte bound before materialization");
      assert.match(sql, /instr\(u\."active_x_user_id", char\(0\)\)/,
        "reserve actor must reject an embedded NUL in the selected ID");
      assert.match(sql, /WITH approved_ids AS MATERIALIZED/,
        "approved X bytes must be preflighted before the JSON aggregate");
      assert.match(sql, /WITH staff_entries AS MATERIALIZED/,
        "staff permission bytes must be preflighted before the JSON aggregate");
      assert.match(sql, /ELSE \(SELECT json_group_array\(q\."x_user_id"\) FROM approved_ids q\)/,
        "the approved X JSON builder must be in a lazy scalar CASE branch");
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values) => {
        const bound = bind(...values);
        const first = bound.first.bind(bound);
        bound.first = async () => {
          const row = await first();
          calls++;
          assert.ok(row?.actor_json, "inspect the actual SQLite first-D1 snapshot");
          const bytes = Object.values(row).reduce((n, value) =>
            n + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0), 0);
          assert.ok(bytes < 64 * 1024, "first D1 row must be bounded before JS parsing");
          inspect(row);
          return row;
        };
        return bound;
      };
      return stmt;
    };
    return () => assert.equal(calls, 1, "reserve uses one inspected first D1 snapshot");
  }

  async function expectMalformedReservationRejected(w, user, inspect, args = {
    eventId: "ev1", slot_id: "s01", display_name: "Safe", consecutive_count: 1,
  }) {
    const watched = watchReserveFirstD1Row(w, inspect);
    const originalState = state(w);
    const beforeReads = w.d1.stats.reads;
    const beforeBatches = w.d1.stats.batches;
    const response = await runHono(w, user, "reserve", args);
    watched();
    assert.equal(response.status, 503, "invalid SQL projection must fail closed");
    assert.deepEqual(response.result, {
      ok: false,
      message: "枠の状態が変更されたか、安全な保存を完了できませんでした。画面を更新してもう一度お試しください。",
    });
    assert.equal(response.cacheControl, "private, no-store");
    assert.equal(response.wakes.length, 0);
    assert.deepEqual(state(w), originalState, "no slots/audit/outbox/queue writes");
    assert.equal(w.d1.stats.batches, beforeBatches, "reject before any atomic D1 write batch");
    assert.ok(w.d1.stats.reads - beforeReads <= 3, "S3 three-read budget");
  }

  for (const [label, bad] of [
    ["180K after leading NUL", "\u0000" + "x".repeat(180_000)],
    ["short embedded NUL", "a\u0000b"],
  ]) {
    test("SEC #716: selected Active X (" + label + ") is never projected into first D1 JSON", async () => {
      const w = world();
      w.sqlite.prepare('UPDATE "user" SET "active_x_user_id" = ? WHERE "id" = ?')
        .run(bad, "u_owner");
      await expectMalformedReservationRejected(w, "u_owner", (raw) => {
        assert.equal(raw.actor_json, '{"__invalid_projection":1}');
        assert.equal(raw.actor_json.includes(bad), false);
      });
    });

    test("SEC #716: approved linked X (" + label + ") fails closed without auth truncation", async () => {
      const w = world();
      insert(w.sqlite, "x_users", { id: bad, x_name: "Legacy", approval_status: "approved" });
      insert(w.sqlite, "x_user_account_links", {
        x_user_id: bad, auth_user_id: "u_owner", link_role: "manager", created_at: 1,
      });
      await expectMalformedReservationRejected(w, "u_owner", (raw) => {
        assert.equal(raw.approved_x_json, "[null]", "invalid linked row becomes SQL sentinel");
        assert.equal(raw.approved_x_json.includes(bad), false);
      });
    });

    test("SEC #716: pending requested X (" + label + ") stays a sentinel before normalization", async () => {
      const w = world();
      insert(w.sqlite, "x_identity_requests", {
        id: "bad_pending_request", request_type: "new_link",
        requested_by_auth_user_id: "u_pend", requested_x_id: bad,
        status: "pending", requested_at: 200, updated_at: 200,
      });
      await expectMalformedReservationRejected(w, "u_pend", (raw) => {
        const pending = JSON.parse(raw.pending_x_json);
        assert.ok(pending.includes(null), "do not silently exclude the malformed request");
        assert.equal(raw.pending_x_json.includes(bad), false);
      });
    });
  }

  for (const [label, updateColumn, invalidValue] of [
    ["permission preset: NUL + 180K", "permission_preset", "\u0000" + "x".repeat(180_000)],
    ["custom permission JSON: NUL + 180K", "custom_permission_keys_json", "\u0000" + "x".repeat(180_000)],
    ["custom permission JSON: short NUL", "custom_permission_keys_json", "a\u0000b"],
  ]) {
    test("SEC #716: staff JSON (" + label + ") is bounded and fails closed", async () => {
      const w = world();
      assert.ok(["permission_preset", "custom_permission_keys_json"].includes(updateColumn));
      const result = w.sqlite.prepare(
        'UPDATE "event_staff" SET "' + updateColumn + '" = ? WHERE "id" = ?',
      ).run(invalidValue, "staff_ev2_slot");
      assert.equal(result.changes, 1, "fixture has exactly one approved event staff row");
      await expectMalformedReservationRejected(w, "u_staff", raw => {
        assert.equal(raw.staff_json, "[null]",
          "unauthorized staff details must never enter first D1 JSON");
        assert.equal(raw.staff_json.includes(invalidValue), false);
      }, {
        eventId: "ev2", slot_id: "ev2_1", display_name: "Safe", consecutive_count: 1,
        operator_override: true,
      });
    });
  }

  for (const [description, apply, field] of [
    ["180K event title", w =>
      w.sqlite.prepare('UPDATE events SET title = ? WHERE id = ?')
        .run("\u0000" + "x".repeat(180_000), "ev1"), "event_json"],
    ["180K anchor slot label", w =>
      w.sqlite.prepare('UPDATE slots SET slot_label = ? WHERE id = ?')
        .run("\u0000" + "x".repeat(180_000), "s01"), "anchor_json"],
    ["180K next slot label inside group JSON", w =>
      w.sqlite.prepare('UPDATE slots SET slot_label = ? WHERE id = ?')
        .run("\u0000" + "x".repeat(180_000), "s02"), "neighbors_json"],
    ["TEXT in a numeric slot field", w =>
      w.sqlite.prepare('UPDATE slots SET version = ? WHERE id = ?')
        .run("x".repeat(180_000), "s01"), "anchor_json"],
  ]) {
    test("SEC #716: unsafe " + description + " is rejected before first D1 JSON", async () => {
      const w = world();
      apply(w);
      await expectMalformedReservationRejected(w, "u_owner", raw => {
        assert.ok(raw[field].includes('"__invalid_projection":1'),
          "malformed legacy event/slot row becomes an explicit bounded sentinel");
        assert.ok(Buffer.byteLength(raw[field], "utf8") < 2048);
      }, {
        eventId: "ev1", slot_id: "s01", display_name: "Safe",
        consecutive_count: field === "neighbors_json" ? 2 : 1,
      });
    });
  }


  test("SEC #716: D1 wire JSON double-escaping stays under 64KiB", async () => {
    const w = world();
    // Every individual field is within the SQL byte limit. JSON1 expands
    // U+0001 to 6 ASCII bytes and D1 quotes each backslash one more time.
    // Four independently bounded JSON columns total ~58KiB on the SQL side
    // yet >64KiB in the actual nested D1 transport JSON.
    const controls = count => String.fromCharCode(1).repeat(count);
    const eventTitle = controls(4096);
    const slotLabel = controls(2048);
    const displayName = controls(512);
    const actorName = controls(512);
    const innerJsonParts = [
      JSON.stringify({ title: eventTitle }),
      JSON.stringify({ slot_label: slotLabel, display_name: displayName }),
      JSON.stringify([{ slot_label: slotLabel, display_name: displayName }]),
      JSON.stringify({ discordName: actorName }),
    ];
    assert.ok(Buffer.byteLength(innerJsonParts.join(""), "utf8") < 60 * 1024,
      "raw SQL JSON fits the old incorrect 60KiB first-row budget");
    assert.ok(Buffer.byteLength(innerJsonParts.map(p => JSON.stringify(p)).join(""), "utf8") > 64 * 1024,
      "outer D1 JSON double-escaping must cross the S3 transport ceiling");
    w.sqlite.prepare('UPDATE events SET title = ? WHERE id = ?').run(eventTitle, "ev1");
    w.sqlite.prepare(
      "UPDATE slots SET slot_label = ?, display_name = ? WHERE id IN ('s01', 's02')",
    ).run(slotLabel, displayName);
    w.sqlite.prepare('UPDATE "user" SET name = ? WHERE id = ?').run(actorName, "u_owner");

    let firstReads = 0;
    const prepare = w.d1.prepare.bind(w.d1);
    w.d1.prepare = sql => {
      const stmt = prepare(sql);
      if (!sql.includes("AS actor_json") ||
          !sql.includes("projected_snapshot AS MATERIALIZED")) return stmt;
      assert.match(sql, /json_quote\(p\."event_json"\)/,
        "preflight must account for D1 outer JSON string escaping");
      assert.match(sql, /json_quote\(p\."anchor_json"\)/);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values) => {
        const bound = bind(...values);
        const first = bound.first.bind(bound);
        bound.first = async () => {
          const row = await first();
          firstReads++;
          assert.equal(row.invalid_snapshot, 1,
            "reject when D1 wire encoding would exceed 64KiB");
          for (const name of ["event_json", "anchor_json", "actor_json", "approved_x_json"]) {
            assert.equal(row[name], null, "no partially usable authorization context");
          }
          assert.ok(Buffer.byteLength(JSON.stringify(row), "utf8") < 1024,
            "SQL must emit a tiny explicit fail-closed response");
          return row;
        };
        return bound;
      };
      return stmt;
    };
    const initial = state(w);
    const batchesBefore = w.d1.stats.batches;
    const readsBefore = w.d1.stats.reads;
    const thaw = freeze();
    try {
      const response = await runHono(w, "u_owner", "reserve", {
        eventId: "ev1", slot_id: "s01", display_name: "Wire-safe", consecutive_count: 2,
      });
      assert.equal(response.status, 503);
      assert.equal(response.cacheControl, "private, no-store");
      assert.equal(response.wakes.length, 0);
      assert.equal(firstReads, 1, "inspect one actual first D1 result");
      assert.equal(w.d1.stats.batches, batchesBefore, "zero mutation batches");
      assert.ok(w.d1.stats.reads - readsBefore <= 3);
      assert.deepEqual(state(w), initial, "zero slot/audit/outbox/queue changes");
    } finally {
      thaw();
    }
  });

  test("SEC #716: JSON escaping inflation is suppressed before a slot array aggregate", async () => {
    const w = world();
    w.sqlite.prepare('UPDATE events SET max_slots_per_video = 20 WHERE id = ?').run("ev1");
    // Every individual value is within its SQL cap. The aggregate would
    // exceed 60KiB; a lazy 20KiB array guard must fire first because JSON
    // escapes control U+0001 to six output bytes per raw byte.
    for (let i = 1; i <= 20; i++) {
      const id = "s" + String(i).padStart(2, "0");
      w.sqlite.prepare(
        'UPDATE slots SET slot_label = ?, display_name = ? WHERE id = ?',
      ).run(String.fromCharCode(1).repeat(2048), "D".repeat(512), id);
    }
    let firstReads = 0;
    const prepare = w.d1.prepare.bind(w.d1);
    w.d1.prepare = (sql) => {
      const stmt = prepare(sql);
      if (!sql.includes("AS neighbors_json") || !sql.includes("AS actor_json")) return stmt;
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values) => {
        const bound = bind(...values);
        const first = bound.first.bind(bound);
        bound.first = async () => {
          const row = await first();
          firstReads++;
          assert.equal(row.invalid_snapshot, 0,
            "the inner array's own 20KiB preflight should reject first");
          assert.equal(row.neighbors_json, '[{"__invalid_projection":1}]',
            "reject before slot JSON array materialization, with explicit sentinel");
          assert.ok(row.actor_json, "non-sensitive bounded fields remain intact");
          assert.ok(Buffer.byteLength(JSON.stringify(row), "utf8") < 4096,
            "large slot group must not leave SQLite into D1");
          return row;
        };
        return bound;
      };
      return stmt;
    };
    const before = state(w);
    const batchesBefore = w.d1.stats.batches;
    const response = await runHono(w, "u_owner", "reserve", {
      eventId: "ev1", slot_id: "s01", display_name: "No mutation", consecutive_count: 20,
    });
    assert.equal(firstReads, 1, "only one first D1 reservation snapshot");
    assert.equal(response.status, 503);
    assert.equal(response.cacheControl, "private, no-store");
    assert.deepEqual(state(w), before, "over-budget source must not mutate");
    assert.equal(w.d1.stats.batches, batchesBefore);
    assert.equal(response.wakes.length, 0);
  });

  test("SEC #716: legacy X IDs accept 128 Unicode codepoints / 512 UTF-8 bytes but reject 129 codepoints", async () => {
    for (const [label, id, invalid, utf8Bytes, codepoints] of [
      ["ASCII128", "a".repeat(128), false, 128, 128],
      ["UTF8-128bytes", "あ".repeat(42) + "ab", false, 128, 44],
      ["Japanese128codepoints", "あ".repeat(128), false, 384, 128],
      ["Emoji128codepoints", "🌀".repeat(128), false, 512, 128],
      ["ASCII129", "a".repeat(129), true, 129, 129],
      ["Japanese129codepoints", "あ".repeat(129), true, 387, 129],
      ["Emoji129codepoints", "🌀".repeat(129), true, 516, 129],
    ]) {
      // The fixture opens entries at NOW_SEC; the host's current clock is
      // deliberately unrelated. Compare allowed CURRENT/Hono paths at the
      // same deterministic instant used by the parity harness.
      const thaw = freeze();
      try {
        const w = world();
      assert.equal(Buffer.byteLength(id, "utf8"), utf8Bytes, label);
      assert.equal(Array.from(id).length, codepoints, label);
      insert(w.sqlite, "x_users", { id, x_name: label, approval_status: "approved" });
      insert(w.sqlite, "x_user_account_links", {
        x_user_id: id, auth_user_id: "u_owner", link_role: "manager", created_at: 1,
      });
      if (invalid) {
        await expectMalformedReservationRejected(w, "u_owner", raw => {
          assert.equal(raw.approved_x_json, "[null]");
        });
      } else {
        const watched = watchReserveFirstD1Row(w, raw => {
          assert.ok(JSON.parse(raw.approved_x_json).includes(id));
        });
        const response = await runHono(w, "u_owner", "reserve", {
          eventId: "ev1", slot_id: "s01", display_name: "Valid " + label, consecutive_count: 1,
        });
        watched();
        assert.equal(response.status, 200, "valid <=128 Unicode-codepoint linked X retains CURRENT rights");
        assert.equal(response.wakes.length, 0);
      }
      } finally {
        thaw();
      }
    }
  });

  test("SEC #716: exactly 100 canonical 20-byte approved links remain authorized and bounded", async () => {
    const thaw = freeze();
    try {
    const w = world();
    let count = w.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM x_user_account_links WHERE auth_user_id = ?",
    ).get("u_owner").n;
    assert.ok(count >= 1 && count < 100);
    for (; count < 100; count++) {
      const id = "approved_" + String(count).padStart(11, "0");
      assert.equal(Buffer.byteLength(id, "utf8"), 20, "exercise the max canonical X handle");
      insert(w.sqlite, "x_users", { id, x_name: id, approval_status: "approved" });
      insert(w.sqlite, "x_user_account_links", {
        x_user_id: id, auth_user_id: "u_owner", link_role: "manager", created_at: 1,
      });
    }
    const watched = watchReserveFirstD1Row(w, raw => {
      assert.equal(JSON.parse(raw.approved_x_json).length, 100,
        "no arbitrary deletion from the authorization set");
    });
    const response = await runHono(w, "u_owner", "reserve", {
      eventId: "ev1", slot_id: "s01", display_name: "Hundred links", consecutive_count: 1,
    });
    watched();
    assert.equal(response.status, 200);
    assert.equal(response.wakes.length, 0);
    } finally {
      thaw();
    }
  });


  // SEC #716: reserve alone is insufficient. Release, extend and merge must
  // reject corrupted group rows without issuing any atomic mutation batch.
  for (const testCase of [
    {
      name: "release",
      setup: [
        ["reserve", { eventId: "ev1", slot_id: "s02", display_name: "Owned", consecutive_count: 2 }],
      ],
      corrupt: "s03",
      operation: "release",
      args: { eventId: "ev1", slot_id: "s02", body: {} },
      field: "group_json",
    },
    {
      name: "extend",
      setup: [
        ["reserve", { eventId: "ev1", slot_id: "s02", display_name: "Owned", consecutive_count: 2 }],
      ],
      corrupt: "s03",
      operation: "extend",
      args: { eventId: "ev1", slot_id: "s02", direction: "forward" },
      field: "group_json",
    },
    {
      name: "merge",
      setup: [
        ["reserve", { eventId: "ev1", slot_id: "s01", display_name: "Left", consecutive_count: 2 }],
        ["reserve", { eventId: "ev1", slot_id: "s04", display_name: "Right", consecutive_count: 2 }],
      ],
      // The adjacent right anchor s04 must stay valid; corrupt only s05
      // so that this test exercises right_group_json, not right_json.
      corrupt: "s05",
      operation: "merge",
      args: { eventId: "ev1", gap_slot_id: "s03", display_name: "Merge" },
      field: "right_group_json",
    },
  ]) {
    test("SEC #716: " + testCase.name + " fails closed before mutation for oversized group member", async () => {
      const w = world();
      const thaw = freeze();
      try {
        for (const [op, args] of testCase.setup) {
          const setup = await runHono(w, "u_owner", op, args);
          assert.equal(setup.status, 200, "setup must establish an authorized reserved group");
          assert.equal(setup.wakes.length, 0);
        }
        const hugeId = "\u0000" + "r".repeat(180_000);
        const updated = w.sqlite.prepare(
          'UPDATE slots SET slot_label = ? WHERE id = ?',
        ).run(hugeId, testCase.corrupt);
        assert.equal(updated.changes, 1, "fixture corrupts exactly one group member");

        let firstD1Reads = 0;
        const prepare = w.d1.prepare.bind(w.d1);
        w.d1.prepare = sql => {
          const stmt = prepare(sql);
          if (!sql.includes("AS " + testCase.field) ||
              !sql.includes("projected_snapshot AS MATERIALIZED")) return stmt;
          const bind = stmt.bind.bind(stmt);
          stmt.bind = (...values) => {
            const bound = bind(...values);
            const first = bound.first.bind(bound);
            bound.first = async () => {
              const row = await first();
              firstD1Reads++;
              assert.ok(row?.[testCase.field]?.includes('"__invalid_projection":1'),
                "group must surface a fixed invalid marker, never omit its bad row");
              assert.equal(row[testCase.field].includes(hugeId), false);
              assert.ok(Buffer.byteLength(JSON.stringify(row), "utf8") < 64 * 1024,
                "raw first D1 row must stay under S3 snapshot budget");
              return row;
            };
            return bound;
          };
          return stmt;
        };
        const before = state(w);
        const batchesBefore = w.d1.stats.batches;
        const readsBefore = w.d1.stats.reads;
        const rejected = await runHono(w, "u_owner", testCase.operation, testCase.args);
        assert.equal(firstD1Reads, 1, "inspect exactly one first D1 snapshot");
        assert.equal(rejected.status, 503, "do not mutate from corrupted authorization group");
        assert.equal(rejected.cacheControl, "private, no-store");
        assert.equal(rejected.wakes.length, 0);
        assert.deepEqual(state(w), before, "no slot, outbox, queue or audit mutation");
        assert.equal(w.d1.stats.batches, batchesBefore, "no atomic writes");
        assert.ok(w.d1.stats.reads - readsBefore <= 3, "S3 D1 pre-read bound");
      } finally {
        thaw();
      }
    });
  }

  test("T03 & T05: reserve, replay, extend (fwd/back/null-adopt), merge, and release match CURRENT field-by-field with 0 wakes", async () => {
    const { b, outcomes } = await compareSteps([
      // SA-065 reserve 2 slots (s02, s03) by u_owner (approved active X).
      ["u_owner", "reserve", { eventId: "ev1", slot_id: "s02", display_name: "Alice Team", consecutive_count: 2 }, 200],
      // SA-065 idempotent replay on own reserved slot s02.
      ["u_owner", "reserve", { eventId: "ev1", slot_id: "s02", display_name: "Alice Team", consecutive_count: 2 }, 200],
      // SA-067 extend forward (s04) and backward (s01).
      ["u_owner", "extend", { eventId: "ev1", slot_id: "s02", direction: "forward" }, 200],
      ["u_owner", "extend", { eventId: "ev1", slot_id: "s02", direction: "backward" }, 200],
      // SA-066 release middle slot s02 (splits s01 vs s03..s04 with new sgrp).
      ["u_owner", "release", { eventId: "ev1", slot_id: "s02" }, 200],
      // SA-068 merge s01 and s03..s04 through gap s02 with new display_name.
      ["u_owner", "merge", { eventId: "ev1", gap_slot_id: "s02", display_name: "Merged Team" }, 200],
      // SA-066 release edge slot s01 (s02..s04 keep existing group).
      ["u_owner", "release", { eventId: "ev1", slot_id: "s01" }, 200],
      // SA-067 extend unassigned (Discord-only) group adopts null x_user_id rows for u_owner's active X.
      ["u_owner", "extend", { eventId: "ev1", slot_id: "s_un1", direction: "forward" }, 200],
      // SA-065 Discord-only (u_nox) and pending-X (u_pend) reservations.
      ["u_nox", "reserve", { eventId: "ev1", slot_id: "s10", display_name: "Discord Only", consecutive_count: 1 }, 200],
      ["u_pend", "reserve", { eventId: "ev1", slot_id: "s11", display_name: "Pending X", consecutive_count: 1 }, 200],
      // SA-066 release singleton Discord-only slot s10.
      ["u_nox", "release", { eventId: "ev1", slot_id: "s10", body: {} }, 200],
    ]);

    // T05: verify CURRENT emitted queue wakes while Hono emitted 0 (D-13-41).
    assert.equal(outcomes[0].expected.wakes.length, 2); // notification + static_rebuild
    assert.equal(outcomes[2].expected.wakes.length, 1); // static_rebuild
    assert.equal(outcomes[4].expected.wakes.length, 1); // static_rebuild
    assert.equal(outcomes[5].expected.wakes.length, 1); // static_rebuild
    for (const o of outcomes) {
      assert.equal(o.actual.wakes.length, 0);
    }

    // Verify notification_outbox event_id and payload_json match CURRENT.
    const outbox = b.sqlite.prepare("SELECT * FROM notification_outbox ORDER BY id").all();
    assert.equal(outbox.length, 3);
    assert.equal(outbox[0].event_id, "ev1");
    assert.equal(outbox[0].delivery_route, "channel");
    assert.equal(JSON.parse(outbox[0].payload_json).webhook_target, "event");
  });

  test("T01: concurrent reserve on same slot allows exactly 1 success and rolls back loser cleanly", async () => {
    const w = world();
    const thaw = freeze();
    try {
      const fired = afterFirstRead(
        w,
        (sql) => /FROM "slots" WHERE "id" = \? AND "event_id" = \? LIMIT 1/i.test(sql),
        (sqlite) => {
          sqlite
            .prepare(
              `UPDATE slots SET status = 'reserved', reserved_by_user_id = 'u_other',
               x_user_id = 'x_other', reserved_x_id_snapshot = 'x_other',
               display_name = 'Winner', version = version + 1, updated_at = ?
               WHERE id = 's05'`,
            )
            .run(NOW_SEC);
        },
      );
      const res = await runHono(w, "u_owner", "reserve", {
        eventId: "ev1",
        slot_id: "s05",
        display_name: "Loser",
        consecutive_count: 1,
      });
      assert.equal(fired(), true);
      assert.equal(res.status, 409);
      assert.equal(res.result.ok, false);
      assert.equal(w.sqlite.prepare("SELECT reserved_by_user_id, display_name, version FROM slots WHERE id = 's05'").get().display_name, "Winner");
      assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
      assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
      assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
    } finally {
      thaw();
    }
  });

  test("T01 & T02: X-ID reservation limit exact/exceeded and concurrent limit race rollback", async () => {
    // T02: lim_1 succeeds (1/1), lim_3 rejected with exact CURRENT limit message.
    await compareSteps([
      ["u_owner", "reserve", { eventId: "ev_limit", slot_id: "lim_1", display_name: "First", consecutive_count: 1 }, 200],
      ["u_owner", "reserve", { eventId: "ev_limit", slot_id: "lim_3", display_name: "Second", consecutive_count: 1 }, 409],
      // Max slots per video = 2 on ev_limit -> 3 rejected.
      ["u_other", "reserve", { eventId: "ev_limit", slot_id: "lim_2", display_name: "OverMax", consecutive_count: 3 }, 409],
    ]);

    // T01: concurrent reserve bypassing pre-read limit triggers atomic buildReservationLimitGuardStatement rollback.
    const w = world();
    const thaw = freeze();
    try {
      const fired = afterFirstRead(
        w,
        (sql) => /FROM "slots" WHERE "id" = \? AND "event_id" = \? LIMIT 1/i.test(sql),
        (sqlite) => {
          sqlite
            .prepare(
              `UPDATE slots SET status = 'reserved', reserved_by_user_id = 'u_owner',
               x_user_id = 'x_owner', reserved_x_id_snapshot = 'x_owner',
               display_name = 'Race1', version = version + 1, updated_at = ?
               WHERE id = 'lim_1'`,
            )
            .run(NOW_SEC);
        },
      );
      const res = await runHono(w, "u_owner", "reserve", {
        eventId: "ev_limit",
        slot_id: "lim_3",
        display_name: "Race2",
        consecutive_count: 1,
      });
      assert.equal(fired(), true);
      assert.equal(res.status, 409);
      assert.equal(res.result.ok, false);
      assert.match(res.result.message, /最大1件まで枠を確保できます/);
      assert.equal(w.sqlite.prepare("SELECT status FROM slots WHERE id = 'lim_3'").get().status, "available");
      assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
      assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
      assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
    } finally {
      thaw();
    }
  });

  test("T02: pending X-ID reservation cap and legacy normalized snapshot match CURRENT", async () => {
    // u_pend has no approved X link, only a pending new_link(x_pend).
    // This exercises the single_pending CTE and pending_x_count, not the
    // active-X branch tested by u_owner, while preserving the one-group cap.
    await compareSteps([
      ["u_pend", "reserve", { eventId: "ev_limit", slot_id: "lim_1", display_name: "Pending first", consecutive_count: 1 }, 200],
      ["u_pend", "reserve", { eventId: "ev_limit", slot_id: "lim_3", display_name: "Pending second", consecutive_count: 1 }, 409],
    ]);

    const a = world();
    const b = world();
    for (const w of [a, b]) {
      w.sqlite.prepare(
        "UPDATE slots SET status = 'reserved', reserved_by_user_id = 'u_pend', " +
        "x_user_id = NULL, reserved_x_id_snapshot = '@X_Pend', " +
        "display_name = 'Legacy pending', version = version + 1 " +
        "WHERE id = 'lim_1' AND event_id = 'ev_limit'",
      ).run();
    }

    const args = { eventId: "ev_limit", slot_id: "lim_2", display_name: "Duplicate pending", consecutive_count: 1 };
    const thawA = freeze();
    let expected;
    try {
      expected = await runCurrent(a, "u_pend", "reserve", args);
    } finally {
      thawA();
    }
    const thawB = freeze();
    let actual;
    try {
      actual = await runHono(b, "u_pend", "reserve", args);
    } finally {
      thawB();
    }
    assert.equal(actual.status, 409, "pending identity must not bypass the single-X reservation cap");
    assert.deepEqual(actual.result, expected.result, "legacy pending snapshot must match CURRENT");
    assert.match(actual.result.message, /最大1件まで枠を確保できます/);
    assert.deepEqual(state(b), state(a), "rejection must not mutate slots, audit, outbox or static queue");
    assert.equal(actual.wakes.length, 0);
    assert.equal(b.d1.stats.batches, 0, "pre-read limit rejection must never start a D1 mutation batch");
  });

  test("T02: reserve D1 bind arity and legacy @/uppercase X-ID reservation cap match CURRENT", async () => {
    const a = world();
    const b = world();
    for (const w of [a, b]) {
      w.sqlite.prepare(
        "UPDATE slots SET status = 'reserved', reserved_by_user_id = 'u_owner', " +
        "x_user_id = 'x_owner', reserved_x_id_snapshot = '@X_Owner', " +
        "display_name = 'Legacy', version = version + 1 " +
        "WHERE id = 'lim_1' AND event_id = 'ev_limit'",
      ).run();
    }

    let validatedReserveReads = 0;
    const prepare = b.d1.prepare.bind(b.d1);
    b.d1.prepare = (sql) => {
      const stmt = prepare(sql);
      if (sql.includes("WITH anchor AS") && sql.includes("AS active_x_count")) {
        const bind = stmt.bind.bind(stmt);
        stmt.bind = (...params) => {
          validatedReserveReads += 1;
          const placeholderCount = (sql.match(/\?/g) ?? []).length;
          assert.equal(params.length, placeholderCount,
            "Cloudflare D1 requires every reserve snapshot SQL placeholder to be bound");
          return bind(...params);
        };
      }
      return stmt;
    };
    const args = { eventId: "ev_limit", slot_id: "lim_2", display_name: "Second group", consecutive_count: 1 };
    const thawA = freeze();
    let expected;
    try {
      expected = await runCurrent(a, "u_owner", "reserve", args);
    } finally {
      thawA();
    }
    const thawB = freeze();
    let actual;
    try {
      actual = await runHono(b, "u_owner", "reserve", args);
    } finally {
      thawB();
    }
    assert.equal(validatedReserveReads, 1, "one batched reserve snapshot read must be checked");
    assert.equal(actual.status, 409);
    assert.deepEqual(actual.result, expected.result);
    assert.match(actual.result.message, /最大1件まで枠を確保できます/);
    assert.deepEqual(state(b), state(a), "denied legacy-X second reservation must never write");
    assert.equal(actual.wakes.length, 0);
  });

  test("T02/T03: all four slot mutation D1 snapshot SQL bindings match placeholder counts", async () => {
    // Cloudflare D1 rejects mismatched bind arity; node:sqlite may silently
    // substitute NULL for missing arguments, masking failures.
    const w = world();
    const observed = [];
    const prepare = w.d1.prepare.bind(w.d1);
    w.d1.prepare = (sql) => {
      const stmt = prepare(sql);
      if (/WITH (?:anchor|gap) AS \(/.test(sql) && sql.includes('projected_snapshot')) {
        const bind = stmt.bind.bind(stmt);
        stmt.bind = (...params) => {
          assert.equal(params.length, (sql.match(/\?/g) ?? []).length,
            "SA-065..068 D1 pre-read SQL and bound parameters must have equal arity");
          observed.push(params.length);
          return bind(...params);
        };
      }
      return stmt;
    };
    const thaw = freeze();
    try {
      const steps = [
        ["reserve", { eventId: "ev1", slot_id: "s02", display_name: "Arity", consecutive_count: 2 }],
        ["extend", { eventId: "ev1", slot_id: "s02", direction: "forward" }],
        ["extend", { eventId: "ev1", slot_id: "s02", direction: "backward" }],
        ["release", { eventId: "ev1", slot_id: "s02" }],
        ["merge", { eventId: "ev1", gap_slot_id: "s02", display_name: "Merged" }],
      ];
      for (const [op, args] of steps) {
        const response = await runHono(w, "u_owner", op, args);
        assert.equal(response.status, 200, op);
        assert.equal(response.result.ok, true, op);
      }
    } finally {
      thaw();
    }
    assert.deepEqual(observed, [16, 6, 6, 2, 6],
      "reserve/extend/extend/release/merge must each read a single complete D1 snapshot");
  });

  test("T02: 20-slot bulk reserve stays within D1 query/bind budget and matches CURRENT", async () => {
    const a = world();
    const b = world();
    a.sqlite.prepare("UPDATE events SET max_slots_per_video = 20 WHERE id = 'ev1'").run();
    b.sqlite.prepare("UPDATE events SET max_slots_per_video = 20 WHERE id = 'ev1'").run();

    const thawA = freeze();
    const expected = await runCurrent(a, "u_owner", "reserve", {
      eventId: "ev1",
      slot_id: "s01",
      display_name: "Bulk20",
      consecutive_count: 20,
    });
    thawA();
    const thawB = freeze();
    const actual = await runHono(b, "u_owner", "reserve", {
      eventId: "ev1",
      slot_id: "s01",
      display_name: "Bulk20",
      consecutive_count: 20,
    });
    thawB();

    assert.equal(actual.status, 200);
    assert.deepEqual(actual.result, expected.result);
    assert.deepEqual(state(b), state(a));
    assert.ok(b.d1.stats.maxBinds <= 100, `maxBinds=${b.d1.stats.maxBinds} <= 100`);
    assert.equal(b.d1.stats.reads, 3);
    assert.equal(b.d1.stats.batches, 1);
  });

  test("T02: operator_override permissions, pre-entry window, cross-part/mismatch/ownership rejections match CURRENT", async () => {
    await compareSteps([
      // Non-staff regular user cannot use operator_override on pre-entry ev2.
      ["u_owner", "reserve", { eventId: "ev2", slot_id: "ev2_1", display_name: "NoPerm", operator_override: true }, 403],
      // Non-override on pre-entry ev2 is rejected (entry not open).
      ["u_staff", "reserve", { eventId: "ev2", slot_id: "ev2_1", display_name: "WaitOpen", operator_override: false }, 409],
      // slot_manager with operator_override succeeds on pre-entry ev2 (even 4 slots? max_slots_per_video is 3, override allows up to 20).
      ["u_staff", "reserve", { eventId: "ev2", slot_id: "ev2_1", display_name: "StaffOp", consecutive_count: 2, operator_override: "1" }, 200],
      // operator_override on ended event ev_closed is rejected.
      ["u_staff", "reserve", { eventId: "ev_closed", slot_id: "closed_1", display_name: "Ended", operator_override: true }, 409],
      // Cross-part reserve (s22 -> s23 gap > 15m) rejected.
      ["u_owner", "reserve", { eventId: "ev1", slot_id: "s22", display_name: "CrossPart", consecutive_count: 2 }, 409],
      // Submitted slot release rejected.
      ["u_owner", "release", { eventId: "ev1", slot_id: "s_sub" }, 409],
      // Different owner release rejected.
      ["u_other", "release", { eventId: "ev1", slot_id: "s_un1" }, 403],
      // Rejected active X user cannot operate on unassigned or another X's slot; can reserve Discord-only.
      ["u_rej", "reserve", { eventId: "ev1", slot_id: "s20", display_name: "RejX" }, 200],
      // Reserve already-taken slot by another user rejected.
      ["u_other", "reserve", { eventId: "ev1", slot_id: "s20", display_name: "Taken" }, 409],
      // Extend by another user rejected.
      ["u_other", "extend", { eventId: "ev1", slot_id: "s20", direction: "forward" }, 403],
      // Missing slot -> 404.
      ["u_owner", "reserve", { eventId: "ev1", slot_id: "no_such_slot", display_name: "Missing" }, 404],
    ]);
  });

  test("T02: cross-event URL mismatch fails closed with 404 and zero writes", async () => {
    const w = world();
    // s01 belongs to ev1, NOT ev2!
    const res = await runHono(w, "u_owner", "reserve", {
      eventId: "ev2",
      slot_id: "s01",
      display_name: "CrossEvent",
      consecutive_count: 1,
    });
    assert.equal(res.status, 404);
    assert.equal(res.result.ok, false);
    assert.equal(w.sqlite.prepare("SELECT status FROM slots WHERE id = 's01'").get().status, "available");
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  });

  test("T04: unauthenticated, banned, TOS, invalid origin, CostGuard, body-limit, and public GET isolation", async () => {
    const w = world();
    const callAnon = honoApp(w, null);
    const callBanned = honoApp(w, "u_owner", { banned: true });
    const callNoTos = honoApp(w, "u_notos");
    const callOwner = honoApp(w, "u_owner");

    // 1. Cross-origin rejected before any D1 read (403 invalid_origin).
    const reads0 = w.d1.stats.reads;
    const badOrigin = await callOwner("/api/events/ev1/slots/s01/reserve", { display_name: "X" }, { Origin: "https://evil.example" });
    assert.equal(badOrigin.status, 403);
    assert.equal((await badOrigin.json()).reason, "invalid_origin");
    assert.equal(w.d1.stats.reads, reads0);

    // 2. Unauthenticated -> 401.
    const unauth = await callAnon("/api/events/ev1/slots/s01/reserve", { display_name: "X" });
    assert.equal(unauth.status, 401);
    assert.equal((await unauth.json()).reason, "unauthenticated");

    // 3. Banned -> 403.
    const banned = await callBanned("/api/events/ev1/slots/s01/reserve", { display_name: "X" });
    assert.equal(banned.status, 403);
    assert.equal((await banned.json()).reason, "banned");

    // 4. TOS required -> 403.
    const noTos = await callNoTos("/api/events/ev1/slots/s01/reserve", { display_name: "X" });
    assert.equal(noTos.status, 403);
    assert.equal((await noTos.json()).reason, "tos_required");

    // 5. Release rejects extra body fields (400), accepts empty body (200 or 404/409).
    const badRelease = await callOwner("/api/events/ev1/slots/s01/release", { slot_id: "spoof" });
    assert.equal(badRelease.status, 400);

    // 6. Oversized body > 64 KiB -> 413.
    const big = await callOwner(
      "/api/events/ev1/slots/s01/reserve",
      undefined,
      { Origin: SITE },
      JSON.stringify({ display_name: "a".repeat(70000) }),
    );
    assert.equal(big.status, 413);

    // 7. CostGuard maintenance_mode -> 503.
    w.sqlite.prepare("UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'").run();
    const maint = await callOwner("/api/events/ev1/slots/s01/reserve", { display_name: "X" });
    assert.equal(maint.status, 503);
    assert.equal((await maint.json()).reason, "maintenance_mode");
    w.sqlite.prepare("UPDATE system_settings SET operation_mode = 'normal' WHERE id = 'default'").run();

    // 8. Mounted real `app`: public GET /api/events and /api/events/ev1/slots/viewer-overlay remain public (no Origin/session required),
    // while POST /api/events/ev1/slots/s01/reserve requires Origin + session.
    const pubListRes = await app.request("/api/events", { method: "GET" }, { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE });
    assert.equal(pubListRes.status, 200);
    const pubOverlayRes = await app.request(
      "/api/events/ev1/slots/viewer-overlay",
      { method: "GET" },
      { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE },
    );
    assert.equal(pubOverlayRes.status, 200);
    assert.equal((await pubOverlayRes.json()).loggedIn, false);
    const mountedBadOrigin = await app.request(
      "/api/events/ev1/slots/s01/reserve",
      {
        method: "POST",
        headers: { "content-type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ display_name: "X" }),
      },
      { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE },
    );
    assert.equal(mountedBadOrigin.status, 403);
    const mountedNoSession = await app.request(
      "/api/events/ev1/slots/s01/reserve",
      {
        method: "POST",
        headers: { "content-type": "application/json", Origin: SITE },
        body: JSON.stringify({ display_name: "X" }),
      },
      { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE },
    );
    assert.equal(mountedNoSession.status, 401);

    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  });
}

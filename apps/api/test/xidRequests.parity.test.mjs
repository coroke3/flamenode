// MIG-0659 SA-099..101: real CURRENT Server Actions (src/lib/actions/xid.ts) vs Hono on the same migrated
// SQLite schema. Only Next/router/auth host ports are replaced; DB, audit, outbox and actions stay real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite, insert } from "./support/personalHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  const stubs = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath() {}",
    "next/navigation": "export function unstable_rethrow() {} export function redirect() {} export function notFound() {}",
    "@/lib/auth/writeGuard": "export async function writeGuard(o) { return globalThis.__xidGuard(o); }",
    "@/lib/serverCore/nextPorts":
      "export const nextQueueWakeHost = { readEnv: () => globalThis.__wakeEnv(), readWaitUntil: () => null, readKv: () => null };",
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier in stubs) return {
        url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true,
      };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const { atomicD1, seedChapterWorld, SITE, SESSION_USER, ROLES, ACTIVE } = await import("./support/chapterSeed.mjs");
  const { Hono } = await import("hono");
  const { createXIdRoutes } = await import("../src/routes/xid/index.ts");
  const current = await import("../../../src/lib/actions/xid.ts");
  const { QUEUE_BINDING_NAMES, QUEUE_FEATURE_FLAG_NAMES } = await import("../../../packages/server-core/src/queues/wakeBudget.ts");
  const { XIdRequestBodySchema, XIdMergeRevertBodySchema, XIdRequestResultSchema } = await import("@flamenode/contracts");
  process.env.NEXT_PUBLIC_SITE_URL = SITE;

  function world(options) {
    const sqlite = createSqlite();
    seedChapterWorld(sqlite);
    // x_taken: approved X owned by u_other besides x_other, so duplicate/ownership rejections have a subject.
    insert(sqlite, "x_users", { id: "x_taken", x_name: "Taken", approval_status: "approved" });
    insert(sqlite, "x_user_account_links", { auth_user_id: "u_other", x_user_id: "x_taken" });
    // A completed merge u_multi may revert (snapshot present, deadline in the future).
    insert(sqlite, "x_identity_requests", {
      id: "merge_done", request_type: "merge", requested_by_auth_user_id: "u_multi", requested_x_id: null,
      source_x_user_id: "x_staff", target_x_user_id: "x_m1", restore_snapshot_json: "{\"v\":1}",
      revert_deadline_at: 1900000000, status: "done", requested_at: 50, updated_at: 60,
    });
    insert(sqlite, "x_identity_requests", {
      id: "merge_late", request_type: "merge", requested_by_auth_user_id: "u_multi", requested_x_id: null,
      source_x_user_id: "x_staff", target_x_user_id: "x_m1", restore_snapshot_json: "{\"v\":1}",
      revert_deadline_at: 1700000000, status: "done", requested_at: 50, updated_at: 60,
    });
    return { sqlite, d1: atomicD1(sqlite, options) };
  }
  const freeze = (initialId = 0) => {
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    let n = initialId;
    Date.now = () => 1800000000000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => { Date.now = originalNow; globalThis.crypto.randomUUID = originalUuid; };
  };
  function state(w) {
    return {
      requests: w.sqlite.prepare("SELECT * FROM x_identity_requests ORDER BY id").all(),
      outbox: w.sqlite.prepare("SELECT * FROM notification_outbox ORDER BY id").all(),
      audits: w.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
      onboarding: w.sqlite.prepare("SELECT id, onboarding_completed_at FROM user ORDER BY id").all(),
    };
  }
  const quiet = async (fn) => {
    const original = { warn: console.warn, log: console.log, info: console.info, error: console.error };
    console.warn = () => {}; console.log = () => {}; console.info = () => {}; console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, original); }
  };

  // op: "request" | "cancel" | "revert". args: { x_id, request_type, target_x_user_id } | id | parent id.
  async function runCurrent(w, user, op, args) {
    const row = w.sqlite.prepare("SELECT id, name, role, active_x_user_id FROM user WHERE id = ?").get(user);
    const wakes = [];
    globalThis.__wakeEnv = () => ({
      [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
      [QUEUE_BINDING_NAMES.notificationWake]: { send: async (payload) => { wakes.push(payload); } },
      [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (payload) => { wakes.push(payload); } },
    });
    globalThis.__xidGuard = async (opts) => {
      assert.equal(opts.feature, "xid_links");
      assert.notEqual(opts.requireActiveXId, true);
      assert.notEqual(opts.requireApprovedActiveXId, true);
      return {
        ok: true, db: drizzle(w.d1), user: {
          id: row.id, name: row.name, role: row.role, active_x_user_id: row.active_x_user_id,
        }, activeXId: row.active_x_user_id, approvedXIds: [], hasPendingXRequest: false,
      };
    };
    const form = new FormData();
    let action;
    if (op === "request") {
      action = current.requestXIdLink;
      for (const [k, v] of Object.entries(args)) form.set(k, v);
    } else if (op === "cancel") {
      action = current.cancelXIdLinkRequest;
      form.set("request_id", args);
    } else {
      action = current.requestXIdMergeRevert;
      form.set("parent_request_id", args);
    }
    const result = await quiet(() => action(form));
    return { result: JSON.parse(JSON.stringify(result)), wakes: wakes.length };
  }

  function honoApp(w, user, { banned = false } = {}) {
    const sessionUser = user
      ? { ...SESSION_USER(user, ROLES[user] ?? "user", ACTIVE[user] ?? null), is_banned: banned ? 1 : 0 }
      : null;
    const hono = new Hono();
    hono.route("/api/xid", createXIdRoutes({
      session: async (c, next) => {
        c.set("user", sessionUser);
        c.set("sessionState", sessionUser ? "user" : "none");
        await next();
      },
    }));
    return (path, body, headers = { Origin: SITE }, raw) =>
      hono.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      }, { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE });
  }
  async function runHono(w, user, op, args) {
    const call = honoApp(w, user);
    const res = op === "request" ? await call("/api/xid/requests", args)
      : op === "cancel" ? await call(`/api/xid/requests/${encodeURIComponent(args)}/cancel`)
      : await call("/api/xid/merge-revert-requests", { parent_request_id: args });
    return { status: res.status, result: await res.json() };
  }

  /** Runs `after(sqlite)` once, right after the first drizzle read (raw()) whose SQL matches. */
  function afterFirstRead(w, matches, after) {
    let fired = false;
    const prepare = w.d1.prepare.bind(w.d1);
    w.d1.prepare = (sql) => {
      const stmt = prepare(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values) => {
        const bound = bind(...values);
        const raw = bound.raw.bind(bound);
        bound.raw = async () => {
          const rows = await raw();
          if (!fired && matches(sql)) { fired = true; after(w.sqlite); }
          return rows;
        };
        return bound;
      };
      return stmt;
    };
    return () => fired;
  }

  /** Runs the same steps on a CURRENT world and a Hono world; every step must agree on result and database. */
  async function compareSteps(steps) {
    const a = world(), b = world();
    const outcomes = [];
    for (const [user, op, args, expectedStatus] of steps) {
      const thawA = freeze(outcomes.length * 100);
      let expected;
      try { expected = await runCurrent(a, user, op, args); } finally { thawA(); }
      const thawB = freeze(outcomes.length * 100);
      let actual;
      try { actual = await runHono(b, user, op, args); } finally { thawB(); }
      assert.deepEqual(actual.result, expected.result, `result ${user} ${op} ${JSON.stringify(args)}`);
      assert.deepEqual(state(b), state(a), `database ${user} ${op} ${JSON.stringify(args)}`);
      assert.equal(actual.status, expectedStatus, `status ${user} ${op} ${JSON.stringify(args)}`);
      assert.equal(XIdRequestResultSchema.safeParse(actual.result).success, true);
      outcomes.push({ expected, actual });
    }
    return { a, b, outcomes };
  }

  test("T03: new_link / existing_link / merge / alias-free success rows (request, audit, outbox, onboarding marker) match CURRENT field by field", async () => {
    const { b, outcomes } = await compareSteps([
      ["u_nox", "request", { x_id: "@NewBie", request_type: "link" }, 200],
      ["u_owner", "request", { x_id: "x_pend", link_type: "link" }, 200],
      ["u_multi", "request", { x_id: "x_staff", request_type: "merge", target_x_user_id: "x_m1" }, 200],
    ]);
    const requests = b.sqlite.prepare("SELECT request_type, status FROM x_identity_requests WHERE id LIKE 'xreq_%' ORDER BY request_type").all();
    assert.deepEqual(requests.map((r) => r.request_type), ["existing_link", "merge", "new_link"]);
    // Link requests enqueue one ops webhook row each, merge none; all on the account forum.
    const outbox = b.sqlite.prepare("SELECT type, delivery_route, status, dedupe_key, payload_json FROM notification_outbox ORDER BY dedupe_key").all();
    assert.equal(outbox.length, 2);
    for (const row of outbox) {
      assert.equal(row.type, "discord_webhook");
      assert.equal(row.delivery_route, "channel");
      assert.equal(JSON.parse(row.payload_json).webhook_target, "account");
      assert.match(row.dedupe_key, /^xid_request_webhook:/);
    }
    // Audit rows carry actor_x_user_id from the guard's active X (null for u_nox).
    const audits = b.sqlite.prepare("SELECT actor_user_id, actor_x_user_id, retention_class FROM audit_logs ORDER BY id").all();
    assert.deepEqual(audits.map((r) => [r.actor_user_id, r.actor_x_user_id]), [["u_nox", null], ["u_owner", "x_owner"], ["u_multi", "x_m1"]]);
    // Link requests mark onboarding complete best-effort; merge does not.
    const marks = Object.fromEntries(b.sqlite.prepare("SELECT id, onboarding_completed_at AS t FROM user").all().map((r) => [r.id, r.t]));
    assert.equal(marks.u_nox, 1800000000);
    assert.equal(marks.u_owner, 1800000000);
    assert.equal(marks.u_multi, null);
    // D-0603-1: CURRENT wakes the notification queue for link requests; Hono never does.
    assert.equal(outcomes[0].expected.wakes, 1);
    assert.equal(outcomes[2].expected.wakes, 0);
  });

  test("T01: double submit is recorded once and answers like CURRENT", async () => {
    const { b, outcomes } = await compareSteps([
      ["u_nox", "request", { x_id: "newbie" }, 200],
      ["u_nox", "request", { x_id: "newbie" }, 200],
    ]);
    assert.equal(outcomes[1].actual.result.message, "同じ内容の申請がすでに承認待ちです。");
    assert.equal(b.sqlite.prepare("SELECT COUNT(*) AS n FROM x_identity_requests WHERE id LIKE 'xreq_%'").get().n, 1);
    assert.equal(b.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 1);
    assert.equal(b.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
  });

  test("T01: concurrent duplicate lost in the atomic insert converges to the single accepted request", async () => {
    // The pending row appears between the handler's pre-read and the batch: the conditional INSERT writes 0 rows.
    const w = world();
    const fired = afterFirstRead(
      w,
      (sql) => /^select/i.test(sql) && /"x_identity_requests"/.test(sql) && /"request_type" in/i.test(sql),
      (sqlite) => sqlite.prepare(`INSERT INTO x_identity_requests
        (id, request_type, requested_by_auth_user_id, requested_x_id, status, requested_at, updated_at)
        VALUES ('xreq_raced','new_link','u_nox','racer','pending',1,1)`).run(),
    );
    const res = await honoApp(w, "u_nox")("/api/xid/requests", { x_id: "racer" });
    assert.equal(fired(), true, "race hook ran between pre-read and batch");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM x_identity_requests WHERE requested_x_id = 'racer'").get().n, 1);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
  });

  test("T02: ownership, already-linked, alias/merge rejections and invalid input match CURRENT with zero mutation", async () => {
    const { b } = await compareSteps([
      ["u_owner", "request", { x_id: "x_owner" }, 409],
      ["u_nox", "request", { x_id: "" }, 400],
      ["u_nox", "request", { x_id: "bad id with spaces!" }, 400],
      ["u_nox", "request", { x_id: "someone", request_type: "bogus" }, 400],
      ["u_owner", "request", { x_id: "x_owner", request_type: "merge" }, 400],
      ["u_owner", "request", { x_id: "x_owner", request_type: "merge", target_x_user_id: "x_other" }, 403],
      ["u_owner", "request", { x_id: "x_taken", request_type: "merge", target_x_user_id: "x_owner" }, 403],
      ["u_owner", "request", { x_id: "ghost_src", request_type: "merge", target_x_user_id: "x_owner" }, 404],
    ]);
    assert.equal(b.d1.stats.batches, 0);
    assert.equal(b.sqlite.prepare("SELECT COUNT(*) AS n FROM x_identity_requests WHERE id LIKE 'xreq_%'").get().n, 0);
  });

  test("T02: sixth pending request hits the limit exactly like CURRENT", async () => {
    const steps = ["a1", "a2", "a3", "a4", "a5", "a6"].map((id, i) => ["u_nox", "request", { x_id: id }, i < 5 ? 200 : 409]);
    const { outcomes } = await compareSteps(steps);
    assert.match(outcomes[5].actual.result.message, /未処理の X ID 申請が多すぎます/);
  });

  test("SA-100: cancel own pending (outbox + CAS), foreign / absent / processed / repeated cancels match CURRENT", async () => {
    const { b } = await compareSteps([
      ["u_nox", "request", { x_id: "tocancel" }, 200],
      ["u_other", "cancel", "xreq_00000000-0000-4000-8000-000000000001", 404],
      ["u_nox", "cancel", "ghost", 404],
      ["u_nox", "cancel", "xreq_00000000-0000-4000-8000-000000000001", 200],
      ["u_nox", "cancel", "xreq_00000000-0000-4000-8000-000000000001", 200],
      ["u_multi", "cancel", "merge_done", 409],
    ]);
    const row = b.sqlite.prepare("SELECT status, decided_by_auth_user_id, decision_reason FROM x_identity_requests WHERE id = 'xreq_00000000-0000-4000-8000-000000000001'").get();
    assert.equal(row.status, "cancelled");
    assert.equal(row.decided_by_auth_user_id, "u_nox");
    assert.equal(row.decision_reason, "申請者による取り下げ");
    const keys = b.sqlite.prepare("SELECT dedupe_key FROM notification_outbox ORDER BY dedupe_key").all().map((r) => r.dedupe_key);
    assert.equal(keys.length, 2);
    assert.match(keys[0], /^xid_cancel_webhook:/);
    assert.match(keys[1], /^xid_request_webhook:/);
  });

  test("SA-101: merge revert creates one child without snapshot copy; repeats, late, foreign and absent parents match CURRENT", async () => {
    const { b } = await compareSteps([
      ["u_multi", "revert", "merge_done", 200],
      ["u_multi", "revert", "merge_done", 200],
      ["u_multi", "revert", "merge_late", 409],
      ["u_owner", "revert", "merge_done", 403],
      ["u_multi", "revert", "ghost", 404],
      ["u_multi", "revert", "", 400],
    ]);
    const children = b.sqlite.prepare("SELECT request_type, parent_request_id, restore_snapshot_json, status FROM x_identity_requests WHERE parent_request_id = 'merge_done'").all();
    assert.deepEqual(children.map((r) => ({ ...r })), [
      { request_type: "revert_merge", parent_request_id: "merge_done", restore_snapshot_json: null, status: "pending" },
    ]);
    // Merge revert enqueues no webhook (CURRENT).
    assert.equal(b.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
  });

  test("SA-101: parent CAS lost between read and insert writes nothing", async () => {
    const w = world();
    const fired = afterFirstRead(
      w,
      (sql) => /^select/i.test(sql) && /"parent_request_id"/.test(sql) && /"request_type" = \?/.test(sql),
      (sqlite) => sqlite.prepare("UPDATE x_identity_requests SET updated_at = updated_at + 1 WHERE id = 'merge_done'").run(),
    );
    const res = await honoApp(w, "u_multi")("/api/xid/merge-revert-requests", { parent_request_id: "merge_done" });
    const body = await res.json();
    assert.equal(fired(), true, "race hook ran between pre-read and batch");
    assert.equal(body.ok, false);
    assert.equal(res.status, 503);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM x_identity_requests WHERE request_type = 'revert_merge'").get().n, 0);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  });

  test("T04: anonymous, cross-origin, banned, malformed and oversized requests never reach mutation", async () => {
    const w = world();
    const anon = await honoApp(w, null)("/api/xid/requests", { x_id: "newbie" });
    assert.equal(anon.status, 401);
    const cross = await honoApp(w, "u_nox")("/api/xid/requests", { x_id: "newbie" }, { Origin: "https://attacker.example" });
    assert.equal(cross.status, 403);
    const noOrigin = await honoApp(w, "u_nox")("/api/xid/requests/xreq_1/cancel", undefined, {});
    assert.equal(noOrigin.status, 403);
    const banned = await honoApp(w, "u_nox", { banned: true })("/api/xid/requests", { x_id: "newbie" });
    assert.equal(banned.status, 403);
    assert.equal((await banned.json()).reason, "banned");
    const revertAnon = await honoApp(w, null)("/api/xid/merge-revert-requests", { parent_request_id: "merge_done" });
    assert.equal(revertAnon.status, 401);
    assert.equal(w.d1.stats.batches, 0);

    const good = honoApp(w, "u_nox");
    const notJson = await good("/api/xid/requests", undefined, { Origin: SITE }, "not json");
    assert.equal(notJson.status, 400);
    const wrongType = await good("/api/xid/requests", { x_id: 5 });
    assert.equal(wrongType.status, 400);
    const big = await good("/api/xid/requests", { x_id: "a".repeat(70000) });
    assert.equal(big.status, 413);
    assert.equal(w.d1.stats.batches, 0);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM x_identity_requests WHERE id LIKE 'xreq_%'").get().n, 0);
  });

  test("responses are private no-store; GET / other methods are not routed", async () => {
    const w = world();
    const res = await honoApp(w, "u_nox")("/api/xid/requests", { x_id: "newbie" });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const hono = new Hono();
    hono.route("/api/xid", createXIdRoutes());
    assert.equal((await hono.request("/api/xid/requests", { method: "GET" }, { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE })).status, 404);
  });

  test("D1 budget: link request is guard reads + bounded handler reads + exactly one batch", async () => {
    const w = world();
    const res = await honoApp(w, "u_nox")("/api/xid/requests", { x_id: "newbie" });
    assert.equal(res.status, 200);
    assert.equal(w.d1.stats.batches, 1, "request, outbox and audit commit as one batch");
    assert.ok(w.d1.stats.reads <= 14, `reads ${w.d1.stats.reads} stay within the S3 budget`);
    assert.ok(w.d1.stats.maxBinds <= 100);
    const rev = world();
    await honoApp(rev, "u_multi")("/api/xid/merge-revert-requests", { parent_request_id: "merge_done" });
    assert.equal(rev.d1.stats.batches, 1);
    assert.ok(rev.d1.stats.reads <= 12, `revert reads ${rev.d1.stats.reads}`);
  });

  test("contract keeps CURRENT FormData keys, defaults and result shape", () => {
    assert.deepEqual(XIdRequestBodySchema.parse({}), { x_id: "", target_x_user_id: "" });
    assert.equal(XIdRequestBodySchema.safeParse({ x_id: 1 }).success, false);
    assert.deepEqual(XIdMergeRevertBodySchema.parse({}), { parent_request_id: "" });
    assert.equal(XIdRequestResultSchema.safeParse({ ok: true, message: "x" }).success, true);
  });
} else {
  test("xidRequests parity (tsx child process)", () => {});
}

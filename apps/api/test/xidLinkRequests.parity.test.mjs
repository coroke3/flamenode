import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  XIdLinkReviewRequestIdSchema,
  XIdLinkApproveBodySchema,
  XIdLinkRejectBodySchema,
  XIdLinkReviewResultSchema,
} from "../../../packages/contracts/src/xidLinkRequest.ts";

test("SA-090/091: URL id preserves CURRENT FormData trim and missing-id denial", () => {
  for (const value of ["  req-01 ", "\treq-02\n", "申請-3"]) {
    const form = new FormData();
    form.set("request_id", value);
    const current = String(form.get("request_id") ?? "").trim();
    assert.equal(XIdLinkReviewRequestIdSchema.parse(value), current);
  }
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse("").success, false);
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse(" \n ").success, false);
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse(null).success, false);
  assert.equal(XIdLinkReviewRequestIdSchema.safeParse(123).success, false);
});

test("SA-090: approval accepts only an empty JSON object; path is authoritative", () => {
  assert.deepEqual(XIdLinkApproveBodySchema.parse({}), {});
  for (const input of [null, [], "", { request_id: "spoof" }, { reason: "unexpected" }]) {
    assert.equal(XIdLinkApproveBodySchema.safeParse(input).success, false);
  }
});

test("SA-091: reject reason is optional, trimmed then truncated at 500 characters", () => {
  assert.deepEqual(XIdLinkRejectBodySchema.parse({}), { reason: "" });
  assert.deepEqual(XIdLinkRejectBodySchema.parse({ reason: "  insufficient proof \n" }),
    { reason: "insufficient proof" });
  for (const text of ["\t" + "a".repeat(504) + "  ", "　理由".repeat(260) + "  "]) {
    const form = new FormData();
    form.set("reason", text);
    const current = String(form.get("reason") ?? "").trim().slice(0, 500);
    assert.equal(XIdLinkRejectBodySchema.parse({ reason: text }).reason, current);
  }
});

test("SA-091: reject body fails closed on invalid types and unsolicited mutation keys", () => {
  for (const input of [null, [], { reason: null }, { reason: 5 },
    { reason: "", request_id: "spoof" }, { actor_x_user_id: "attacker" }]) {
    assert.equal(XIdLinkRejectBodySchema.safeParse(input).success, false);
  }
});

test("SA-090/091: result DTO is closed and carries only CURRENT result fields", () => {
  assert.deepEqual(XIdLinkReviewResultSchema.parse({ ok: true, message: "却下しました。" }),
    { ok: true, message: "却下しました。" });
  assert.deepEqual(XIdLinkReviewResultSchema.parse({ ok: false }), { ok: false });
  assert.equal(XIdLinkReviewResultSchema.safeParse({ ok: "true" }).success, false);
  assert.equal(XIdLinkReviewResultSchema.safeParse({ ok: true, actor_x_user_id: "spoof" }).success, false);
});

import { drizzle } from "drizzle-orm/d1";
import { createSqlite, insert } from "./support/personalHarness.mjs";
import { atomicD1, seedChapterWorld } from "./support/chapterSeed.mjs";
import {
  authorizeXIdLinkRequestReview,
  xidLinkRequestReviewAuthorizationMiddleware,
} from "../src/routes/xid/linkRequests.ts";

test("SA-090/091 T08: review authorization allows admin and explicitly authorized approved-X staff only", async () => {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  insert(sqlite, "event_staff", {
    id: "s_xid_reviewer",
    event_id: "ev2",
    x_user_id: "x_staff",
    display_name: "X ID reviewer",
    permission_preset: "xid_reviewer",
  });
  const d1 = atomicD1(sqlite);
  const db = drizzle(d1);

  const admin = await authorizeXIdLinkRequestReview(db, {
    id: "u_admin", role: "admin", active_x_user_id: "x_admin",
  });
  assert.deepEqual(admin, { allowed: true, actorXUserId: null });

  const authorizedStaff = await authorizeXIdLinkRequestReview(db, {
    id: "u_staff", role: "user", active_x_user_id: "x_staff",
  });
  assert.deepEqual(authorizedStaff, { allowed: true, actorXUserId: "x_staff" });

  const unauthorizedStaff = await authorizeXIdLinkRequestReview(db, {
    id: "u_other", role: "user", active_x_user_id: "x_other",
  });
  assert.deepEqual(unauthorizedStaff, {
    allowed: false,
    actorXUserId: null,
    message: "X ID 申請を処理する権限がありません。",
  });

  assert.equal(d1.stats.batches, 0, "authorization must not write or batch any D1 statements");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM x_identity_requests").get().count, 0);
  sqlite.close();
});


test("SA-090/091 SEC: review DB failures deny 503 without logging provider SQL or credentials", async () => {
  const secret = "token=private-review-secret";
  const badDb = new Proxy({}, {
    get(_target, property) {
      if (property === "select") {
        throw new Error("SELECT * FROM private_accounts " + secret);
      }
      return undefined;
    },
  });
  let downstreamCalls = 0;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: "u_staff", role: "user", active_x_user_id: "x_staff" });
    c.set("db", badDb);
    await next();
  });
  app.use("*", xidLinkRequestReviewAuthorizationMiddleware);
  app.get("/review", (c) => {
    downstreamCalls++;
    return c.json({ ok: true });
  });
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const response = await app.request("/review");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false, message: "時間をおいて再試行してください。",
    });
    assert.equal(downstreamCalls, 0, "a broken authorization query must not call the handler");
    assert.deepEqual(logged, [["[xid] review authorization failed"]]);
    assert.doesNotMatch(JSON.stringify(logged), /private-review-secret|private_accounts|SELECT|token=/);
  } finally {
    console.error = originalError;
  }
});

test("SA-090/091 SEC: throwing authorization diagnostic sink preserves controlled 503", async () => {
  const canary = "SYNTHETIC_REVIEW_PROVIDER_CANARY";
  let authorizationCalls = 0;
  const badDb = new Proxy({}, {
    get(_target, property) {
      if (property === "select") {
        authorizationCalls++;
        throw new Error("SELECT * FROM private_accounts " + canary);
      }
      return undefined;
    },
  });
  let downstreamCalls = 0;
  let unhandledErrors = 0;
  let actorAtExit;
  const app = new Hono();
  app.onError((_error, c) => {
    unhandledErrors++;
    return c.json({ ok: false, message: "unexpected_error" }, 500);
  });
  app.use("*", async (c, next) => {
    c.set("user", { id: "u_staff", role: "user", active_x_user_id: "x_staff" });
    c.set("db", badDb);
    await next();
    actorAtExit = c.get("xidLinkRequestActorXUserId");
  });
  app.use("*", xidLinkRequestReviewAuthorizationMiddleware);
  app.get("/review", (c) => {
    downstreamCalls++;
    return c.json({ ok: true });
  });
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => {
    logged.push(args);
    throw new Error("SYNTHETIC_DIAGNOSTIC_SINK_CANARY");
  };
  try {
    const response = await app.request("/review");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false, message: "時間をおいて再試行してください。",
    });
    assert.ok(authorizationCalls > 0, "provider fault must be exercised");
    assert.equal(downstreamCalls, 0);
    assert.equal(unhandledErrors, 0);
    assert.equal(actorAtExit, undefined);
    assert.deepEqual(logged, [["[xid] review authorization failed"]]);
  } finally {
    console.error = originalError;
  }
});

test("SA-090/091 SEC: downstream failures remain separate from authorization failures", async () => {
  const app = new Hono();
  app.onError((_error, c) => c.json({ ok: false, error: "mutation_failed" }, 502));
  app.use("*", async (c, next) => {
    c.set("user", { id: "u_admin", role: "admin", active_x_user_id: null });
    await next();
  });
  app.use("*", xidLinkRequestReviewAuthorizationMiddleware);
  app.get("/review", () => { throw new Error("mutation failure after permission was granted"); });
  const response = await app.request("/review");
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "mutation_failed" });
});

test("SA-090/091 T08 middleware carries the exact authorizing X identity and denies unauthorized staff", async () => {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  insert(sqlite, "event_staff", {
    id: "s_xid_reviewer",
    event_id: "ev2",
    x_user_id: "x_staff",
    display_name: "X ID reviewer",
    permission_preset: "xid_reviewer",
  });
  const d1 = atomicD1(sqlite);
  const db = drizzle(d1);

  async function requestAs(user) {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("user", user);
      await next();
    });
    app.use("*", xidLinkRequestReviewAuthorizationMiddleware);
    app.get("/review", (c) => c.json({
      actorXUserId: c.get("xidLinkRequestActorXUserId"),
    }));
    return app.request("/review");
  }

  const admin = await requestAs({ id: "u_admin", role: "admin", active_x_user_id: "x_admin" });
  assert.equal(admin.status, 200);
  assert.deepEqual(await admin.json(), { actorXUserId: null });

  const reviewer = await requestAs({ id: "u_staff", role: "user", active_x_user_id: "x_staff" });
  assert.equal(reviewer.status, 200);
  assert.deepEqual(await reviewer.json(), { actorXUserId: "x_staff" });

  const denied = await requestAs({ id: "u_other", role: "user", active_x_user_id: "x_other" });
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    ok: false,
    message: "X ID 申請を処理する権限がありません。",
  });

  assert.equal(d1.stats.batches, 0, "authorization middleware must not mutate D1");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM x_identity_requests").get().count, 0);
  sqlite.close();
});

import { notificationOutbox } from "@flamenode/db/schema";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { planXIdLinkRejection } from "@flamenode/server-core/xid/linkRequestReview";

// Exercise the actual shared plan and atomic audit implementation against the
// migrated schema. These are deliberately synthetic outbox envelopes: payload
// rendering, transport authorization, and Queue delivery have separate gates.
test("SA-091 atomic rejection preserves committed outbox and rolls back CAS or late failures", async () => {
  const cases = [
    { name: "no notifications", routes: [], commit: true, actorX: null },
    { name: "both notifications", routes: ["dm", "channel"], commit: true, actorX: "x_staff" },
    { name: "duplicate DM is idempotent", routes: ["dm", "channel"], duplicate: true, commit: true, actorX: "x_staff" },
    { name: "concurrent approval", routes: ["dm", "channel"], race: "approved", commit: false, actorX: "x_staff" },
    { name: "missing request", routes: ["dm", "channel"], race: "missing", commit: false, actorX: "x_staff" },
    { name: "late channel insert failure", routes: ["dm", "channel"], fault: "channel", commit: false, actorX: "x_staff" },
    { name: "late strict audit failure", routes: ["dm", "channel"], fault: "audit", commit: false, actorX: "x_staff" },
    { name: "audit insert silently skipped", routes: ["dm", "channel"], fault: "audit-assertion", commit: false, actorX: "x_staff" },
  ];
  for (const scenario of cases) {
    const sqlite = createSqlite();
    try {
      seedChapterWorld(sqlite);
      sqlite.exec("UPDATE system_settings SET audit_max_payload_bytes = 90000 WHERE id = 'default'");
      insert(sqlite, "x_identity_requests", {
        id: "reject-fixture", request_type: "new_link",
        requested_by_auth_user_id: "u_other", requested_x_id: "candidate",
        status: "pending", requested_at: 10, updated_at: 10,
      });
      insert(sqlite, "x_identity_requests", {
        id: "unrelated-fixture", request_type: "new_link",
        requested_by_auth_user_id: "u_other", requested_x_id: "unrelated",
        status: "pending", requested_at: 11, updated_at: 11,
      });
      const readRequest = () => sqlite.prepare("SELECT * FROM x_identity_requests WHERE id = 'reject-fixture'").get();
      const readOutbox = () => sqlite.prepare("SELECT id, delivery_route, dedupe_key, payload_json FROM notification_outbox ORDER BY id").all();
      const readAudits = () => sqlite.prepare("SELECT * FROM audit_logs WHERE table_name = 'x_identity_requests' ORDER BY id").all();
      const request = { ...readRequest() };
      const d1 = atomicD1(sqlite);
      const db = drizzle(d1);
      const actorUserId = scenario.actorX === null ? "u_admin" : "u_staff";
      const envelope = (route, id = route + "-fixture") => ({
        id, recipient_user_id: route === "dm" ? "u_other" : actorUserId,
        type: route === "dm" ? "x_id_rejected" : "discord_webhook",
        payload_json: JSON.stringify({ fixture: route }),
        delivery_route: route, status: "pending", created_at: 20,
        dedupe_key: "reject-fixture:" + route,
      });
      if (scenario.duplicate) insert(sqlite, "notification_outbox", envelope("dm", "original-dm"));
      const plan = planXIdLinkRejection(db, {
        request, actorUserId, actorXUserId: scenario.actorX,
        reason: "manual decision", now: 20,
        notificationStatements: scenario.routes.map((route) =>
          db.insert(notificationOutbox).values(envelope(route)).onConflictDoNothing()),
      });
      if (scenario.race === "approved") {
        sqlite.exec("UPDATE x_identity_requests SET status='approved', updated_at=30 WHERE id='reject-fixture'");
      } else if (scenario.race === "missing") {
        sqlite.exec("DELETE FROM x_identity_requests WHERE id='reject-fixture'");
      }
      // Observe the exact injected trigger even when the transaction rolls back.
      // A generic rejection before the intended late fault must not pass.
      const faultHits = [];
      sqlite.function("fixture_fault_hit", (stage) => { faultHits.push(stage); return 0; });
      if (scenario.fault === "channel") {
        sqlite.exec("CREATE TRIGGER fail_channel BEFORE INSERT ON notification_outbox WHEN NEW.delivery_route='channel' BEGIN SELECT fixture_fault_hit('channel'); SELECT RAISE(ABORT, 'fixture channel failure'); END");
      } else if (scenario.fault === "audit") {
        sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs WHEN NEW.table_name='x_identity_requests' BEGIN SELECT fixture_fault_hit('audit'); SELECT RAISE(ABORT, 'fixture audit failure'); END");
      } else if (scenario.fault === "audit-assertion") {
        // The INSERT itself succeeds with zero rows; the audit count assertion
        // must fail closed and undo the earlier request and outbox mutations.
        sqlite.exec("CREATE TRIGGER skip_audit BEFORE INSERT ON audit_logs WHEN NEW.table_name='x_identity_requests' BEGIN SELECT fixture_fault_hit('audit-assertion'); SELECT RAISE(IGNORE); END");
      }
      const beforeRequest = readRequest();
      const beforeOutbox = readOutbox();
      const beforeAudits = readAudits();
      const beforeUnrelated = sqlite.prepare("SELECT * FROM x_identity_requests WHERE id='unrelated-fixture'").get();
      if (scenario.commit) {
        const ids = await mutateWithAudit(db, plan);
        assert.equal(ids.length, 1, scenario.name);
        const after = readRequest();
        assert.equal(after.status, "rejected", scenario.name);
        assert.equal(after.updated_at, 20, scenario.name);
        assert.equal(after.decided_at, 20, scenario.name);
        assert.equal(after.decided_by_auth_user_id, actorUserId, scenario.name);
        assert.equal(after.decision_reason, "manual decision", scenario.name);
        assert.equal(after.slot_bind_status, request.slot_bind_status, scenario.name);
        const rows = readOutbox();
        assert.equal(rows.length, scenario.routes.length, scenario.name);
        for (const route of scenario.routes) {
          const row = rows.find((item) => item.delivery_route === route);
          assert.equal(row?.id, route === "dm" && scenario.duplicate ? "original-dm" : route + "-fixture", scenario.name);
          assert.equal(row?.dedupe_key, "reject-fixture:" + route, scenario.name);
          assert.deepEqual(JSON.parse(row.payload_json), { fixture: route }, scenario.name);
        }
        const audits = readAudits();
        assert.equal(audits.length, 1, scenario.name);
        const audit = audits[0];
        assert.equal(audit.id, ids[0], scenario.name);
        assert.equal(audit.actor_user_id, actorUserId, scenario.name);
        assert.equal(audit.actor_x_user_id, scenario.actorX, scenario.name);
        assert.equal(audit.target_id, request.id, scenario.name);
        assert.equal(audit.operation, "UPDATE", scenario.name);
        assert.equal(audit.retention_class, "long_audit", scenario.name);
        assert.equal(audit.reason, "manual decision", scenario.name);
        assert.equal(JSON.parse(audit.before_json).status, "pending", scenario.name);
        assert.equal(JSON.parse(audit.after_json).status, "rejected", scenario.name);
        assert.equal(JSON.parse(audit.after_json).decided_by_auth_user_id, actorUserId, scenario.name);
        // A replay of the stale plan must not append another audit or outbox row.
        await assert.rejects(() => mutateWithAudit(db, plan), scenario.name);
        assert.deepEqual(readRequest(), after, scenario.name);
        assert.deepEqual(readOutbox(), rows, scenario.name);
        assert.deepEqual(readAudits(), audits, scenario.name);
        assert.equal(d1.stats.batches, 2, scenario.name);
      } else {
        await assert.rejects(() => mutateWithAudit(db, plan), scenario.name);
        assert.deepEqual(readRequest(), beforeRequest, scenario.name);
        assert.deepEqual(readOutbox(), beforeOutbox, scenario.name);
        assert.deepEqual(readAudits(), beforeAudits, scenario.name);
        assert.equal(d1.stats.batches, 1, scenario.name);
      }
      assert.deepEqual(faultHits, scenario.fault ? [scenario.fault] : [], scenario.name);
      assert.deepEqual(sqlite.prepare("SELECT * FROM x_identity_requests WHERE id='unrelated-fixture'").get(), beforeUnrelated, scenario.name);
    } finally {
      sqlite.close();
    }
  }
});


// TARGET audit actor is authorization evidence, not necessarily the active X.
// This synthetic host exercises the real middleware, shared plan and atomic
// mutation against the migrated schema; it is not a mounted production endpoint.
test("SA-091 authorization evidence reaches persisted audit without trusting active X alone", async () => {
  const cases = [
    { name: "admin with active X", id: "u_admin", role: "admin", active: "x_admin", actor: null },
    { name: "admin without active X", id: "u_admin", role: "admin", active: null, actor: null },
    { name: "staff active X authorizes", id: "u_staff", role: "user", active: "x_staff", actor: "x_staff" },
    { name: "staff other linked X authorizes", id: "u_multi", role: "user", active: "x_m1", actor: "x_staff" },
    { name: "staff no active X", id: "u_multi", role: "user", active: null, actor: "x_staff" },
    { name: "multiple authorizing X prefer active", id: "u_multi", role: "user", active: "x_staff", both: true, actor: "x_staff" },
    { name: "multiple authorizing X deterministic fallback", id: "u_multi", role: "user", active: null, both: true, actor: "x_m1" },
    { name: "linked but unauthorized staff", id: "u_other", role: "user", active: "x_other", denied: 403 },
    { name: "foreign active X cannot authorize", id: "u_other", role: "user", active: "x_staff", denied: 403 },
    { name: "no linked X", id: "u_nox", role: "user", active: null, denied: 403 },
    { name: "anonymous", id: null, role: null, active: null, denied: 401 },
  ];
  for (const scenario of cases) {
    const sqlite = createSqlite();
    try {
      seedChapterWorld(sqlite);
      sqlite.exec("UPDATE system_settings SET audit_max_payload_bytes = 90000 WHERE id = 'default'");
      insert(sqlite, "event_staff", {
        id: "s_xid_reviewer", event_id: "ev2", x_user_id: "x_staff",
        display_name: "X reviewer", permission_preset: "xid_reviewer",
      });
      if (scenario.both) {
        insert(sqlite, "event_staff", {
          id: "s_xid_reviewer_second", event_id: "ev2", x_user_id: "x_m1",
          display_name: "Second X reviewer", permission_preset: "xid_reviewer",
        });
      }
      // For normal receipts mirror the selected X in the stored session fixture.
      // The foreign-active case deliberately supplies only a synthetic session
      // mismatch; it must not create an approved account link or any authority.
      if (scenario.id && !scenario.denied) {
        sqlite.prepare("UPDATE user SET active_x_user_id = ? WHERE id = ?").run(scenario.active, scenario.id);
      }
      insert(sqlite, "x_identity_requests", {
        id: "actor-fixture", request_type: "new_link",
        requested_by_auth_user_id: "u_other", requested_x_id: "candidate",
        status: "pending", requested_at: 10, updated_at: 10,
      });
      const readRequest = () => sqlite.prepare("SELECT * FROM x_identity_requests WHERE id = 'actor-fixture'").get();
      const before = readRequest();
      const d1 = atomicD1(sqlite);
      const db = drizzle(d1);
      const app = new Hono();
      let handlerCalls = 0;
      app.use("*", async (c, next) => {
        c.set("db", db);
        c.set("user", scenario.id ? {
          id: scenario.id, role: scenario.role, active_x_user_id: scenario.active,
        } : null);
        await next();
      });
      app.use("*", xidLinkRequestReviewAuthorizationMiddleware);
      app.post("/review", async (c) => {
        handlerCalls++;
        const actorUserId = c.get("user").id;
        const actorXUserId = c.get("xidLinkRequestActorXUserId");
        const plan = planXIdLinkRejection(db, {
          request: { ...readRequest() }, actorUserId, actorXUserId,
          reason: "actor fixture", now: 20,
          notificationStatements: [db.insert(notificationOutbox).values({
            id: "actor-outbox", recipient_user_id: actorUserId,
            type: "discord_webhook", payload_json: JSON.stringify({ operatorUserId: actorUserId }),
            delivery_route: "channel", status: "pending", created_at: 20,
            dedupe_key: "actor-fixture:channel",
          }).onConflictDoNothing()],
        });
        await mutateWithAudit(db, plan);
        return c.json({ ok: true });
      });
      const response = await app.request("/review", { method: "POST" });
      const audits = sqlite.prepare("SELECT * FROM audit_logs WHERE table_name = 'x_identity_requests' AND target_id = 'actor-fixture'").all();
      const outbox = sqlite.prepare("SELECT recipient_user_id, payload_json FROM notification_outbox WHERE id = 'actor-outbox'").all();
      if (scenario.denied) {
        assert.equal(response.status, scenario.denied, scenario.name);
        assert.equal((await response.json()).ok, false, scenario.name);
        assert.equal(handlerCalls, 0, scenario.name);
        assert.equal(d1.stats.batches, 0, scenario.name);
        assert.deepEqual(readRequest(), before, scenario.name);
        assert.equal(audits.length, 0, scenario.name);
        assert.equal(outbox.length, 0, scenario.name);
      } else {
        assert.equal(response.status, 200, scenario.name);
        assert.deepEqual(await response.json(), { ok: true }, scenario.name);
        assert.equal(handlerCalls, 1, scenario.name);
        assert.equal(d1.stats.batches, 1, scenario.name);
        const after = readRequest();
        assert.equal(after.status, "rejected", scenario.name);
        assert.equal(after.decided_by_auth_user_id, scenario.id, scenario.name);
        assert.equal(after.slot_bind_status, before.slot_bind_status, scenario.name);
        assert.equal(audits.length, 1, scenario.name);
        assert.equal(audits[0].actor_user_id, scenario.id, scenario.name);
        assert.equal(audits[0].actor_x_user_id, scenario.actor, scenario.name);
        assert.equal(audits[0].operation, "UPDATE", scenario.name);
        assert.equal(audits[0].retention_class, "long_audit", scenario.name);
        assert.equal(JSON.parse(audits[0].before_json).status, "pending", scenario.name);
        assert.equal(JSON.parse(audits[0].after_json).status, "rejected", scenario.name);
        assert.equal(outbox.length, 1, scenario.name);
        assert.equal(outbox[0].recipient_user_id, scenario.id, scenario.name);
        assert.deepEqual(JSON.parse(outbox[0].payload_json), { operatorUserId: scenario.id }, scenario.name);
      }
    } finally {
      sqlite.close();
    }
  }
});

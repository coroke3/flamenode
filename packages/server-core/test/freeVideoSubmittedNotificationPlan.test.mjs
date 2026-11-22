import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "@flamenode/db/schema";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { buildFreeVideoSubmittedNotificationPlan } from "../src/video/freeVideoSubmittedNotificationPlan.ts";
import { buildFreeVideoSubmittedNotificationPlan as publicPlan } from "@flamenode/server-core/video/unslottedEventPlans";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

const NOW = 1770000000;
const payload = () => ({
  content: "【FlameNode】作品を受け付けました",
  video_id: "v-test", url: "https://flamenode.example/v-test",
});
function dbFor(sqlite, stats) {
  return drizzle(async (query, params, method) => {
    stats.reads += 1;
    const rows = sqlite.prepare(query).all(...params);
    return { rows: method === "all" || method === "values"
      ? rows.map((row) => Object.values(row)) : rows };
  }, { schema });
}
function args(overrides = {}) {
  return { videoId: "v-test", actorUserId: "user-1", eventId: null,
    payload: payload(), now: NOW, ...overrides };
}

test("MIG-0651 notification: public core entry resolves exact implementation", () => {
  assert.strictEqual(publicPlan, buildFreeVideoSubmittedNotificationPlan);
});

test("MIG-0651 notification: invalid, foreign or oversized trusted payload fails before any D1 work", async () => {
  const noDb = { select() { throw Error("must not read"); }, insert() { throw Error("must not write"); } };
  for (const bad of [
    { videoId: "" },
    { actorUserId: "" },
    { eventId: "" },
    { now: -1 },
    { payload: { ...payload(), video_id: "another-video" } },
    { payload: { ...payload(), content: "x".repeat(2001) } },
    { payload: { ...payload(), url: "//evil.example" } },
    { payload: { ...payload(), event_id: "unrelated-event" } },
    { payload: { ...payload(), foo: "x".repeat(8192) } },
  ]) {
    await assert.rejects(() => buildFreeVideoSubmittedNotificationPlan(noDb, args(bad)),
      /free_video_submitted_notification_(?:invalid|payload_too_large)/);
  }
  const circular = payload();
  circular.extra = circular;
  await assert.rejects(() => buildFreeVideoSubmittedNotificationPlan(noDb, args({ payload: circular })),
    /free_video_submitted_notification_invalid/);
});

test("MIG-0651 notification: full migrated SQLite queues one video_submitted DM, no send", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    const stats = { reads: 0 };
    const db = dbFor(sqlite, stats);
    const plan = await buildFreeVideoSubmittedNotificationPlan(db, args({ eventId: "event-a" }));
    assert.equal(stats.reads, 1, "active dedupe and recipient preference share one D1 SELECT");
    assert.deepEqual(plan.expectedChanges, [null]);
    assert.equal(plan.statements.length, 1);
    assert.equal(plan.audits.length, 0, "CURRENT notification does not create strict video audit entries");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0,
      "the candidate must not execute prepared INSERTs");
    const q = plan.statements[0].toSQL();
    assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
    assert.equal(sqlite.prepare(q.sql).run(...q.params).changes, 1);
    const row = sqlite.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(row.type, "video_submitted");
    assert.equal(row.delivery_route, "dm");
    assert.equal(row.recipient_user_id, "user-1");
    assert.equal(row.status, "pending");
    assert.equal(row.dedupe_key, "video_submitted:v-test");
    assert.equal(row.event_id, "event-a");
    assert.equal(row.created_at, NOW);
    assert.equal(row.attempt_count, 0);
    assert.equal(row.processing_started_at, null);
    assert.equal(row.lease_token, null);
    assert.equal(row.processed_at, null);
    assert.equal(JSON.parse(row.payload_json).video_id, "v-test");
  } finally { sqlite.close(); }
});

test("MIG-0651 notification: disabled recipient produces no outbox write", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 0 });
    const stats = { reads: 0 };
    const plan = await buildFreeVideoSubmittedNotificationPlan(dbFor(sqlite, stats), args());
    assert.equal(stats.reads, 1);
    assert.deepEqual(plan, { statements: [], expectedChanges: [], audits: [] });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
  } finally { sqlite.close(); }
});

test("MIG-0651 notification: existing and racing active-dedupe notification stay idempotent", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    const stats = { reads: 0 };
    const db = dbFor(sqlite, stats);
    const pending = await buildFreeVideoSubmittedNotificationPlan(db, args());
    assert.equal(pending.statements.length, 1);
    insert(sqlite, "notification_outbox", {
      id: "racing-id", recipient_user_id: "user-1", type: "video_submitted",
      payload_json: JSON.stringify(payload()), status: "pending",
      dedupe_key: "video_submitted:v-test", created_at: NOW, delivery_route: "dm",
    });
    const q = pending.statements[0].toSQL();
    assert.equal(sqlite.prepare(q.sql).run(...q.params).changes, 0,
      "the canonical partial unique index allows exactly one active notification");
    const after = await buildFreeVideoSubmittedNotificationPlan(db, args());
    assert.deepEqual(after, { statements: [], expectedChanges: [], audits: [] });
    assert.equal(stats.reads, 2, "one joined preflight read per attempt, even with active dedupe");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 1);
  } finally { sqlite.close(); }
});

test("MIG-0651 notification: active dedupe short-circuits absent recipient without a second D1 query", async () => {
  const sqlite = createSqlite();
  try {
    const stats = { reads: 0 };
    const noUser = await buildFreeVideoSubmittedNotificationPlan(dbFor(sqlite, stats), args());
    assert.deepEqual(noUser, { statements: [], expectedChanges: [], audits: [] });
    assert.equal(stats.reads, 1);

    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    for (const status of ["processing", "sent"]) {
      insert(sqlite, "notification_outbox", {
        id: "old-" + status, recipient_user_id: "user-1",
        type: "video_submitted", payload_json: JSON.stringify(payload()),
        status, dedupe_key: "video_submitted:v-test",
        created_at: NOW, delivery_route: "dm",
      });
      const plan = await buildFreeVideoSubmittedNotificationPlan(dbFor(sqlite, stats), args());
      assert.deepEqual(plan, { statements: [], expectedChanges: [], audits: [] },
        status + " is an active dedupe state");
      sqlite.prepare("DELETE FROM notification_outbox WHERE id=?").run("old-" + status);
    }
    assert.equal(stats.reads, 3, "one read for absent user + one per active dedupe state");
  } finally { sqlite.close(); }
});

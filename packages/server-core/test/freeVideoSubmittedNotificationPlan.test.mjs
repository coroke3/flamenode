import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { buildFreeVideoSubmittedNotificationPlan } from "../src/video/freeVideoSubmittedNotificationPlan.ts";
import { buildFreeVideoSubmittedNotificationPlan as publicPlan } from "@flamenode/server-core/video/unslottedEventPlans";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

const NOW = 1770000000;
const payload = () => ({
  content: "【FlameNode】作品を受け付けました",
  video_id: "v-test", url: "https://flamenode.example/v-test",
});
function args(overrides = {}) {
  return { videoId: "v-test", actorUserId: "user-1", eventId: null,
    payload: payload(), now: NOW, ...overrides };
}
function planDb() {
  const state = { reads: 0, writes: 0, prepared: 0 };
  return {
    state,
    db: {
      select() { state.reads++; throw new Error("the plan must not pre-read D1"); },
      insert() { state.writes++; throw new Error("the plan must not execute INSERT"); },
      run(expr) { state.prepared++; return { sqlExpr: expr }; },
    },
  };
}
const dialect = new SQLiteSyncDialect();
function compiled(plan) {
  assert.deepEqual(plan.expectedChanges, [null]);
  assert.equal(plan.statements.length, 1);
  assert.deepEqual(plan.audits, []);
  const stmt = plan.statements[0];
  assert.ok("sqlExpr" in stmt, "the same-batch INSERT must remain unexecuted");
  const q = dialect.sqlToQuery(stmt.sqlExpr);
  assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
  assert.match(q.sql, /^\s*INSERT INTO notification_outbox\s*\(/i);
  assert.match(q.sql, /ON CONFLICT DO NOTHING/i);
  return q;
}
function execute(sqlite, plan) {
  const q = compiled(plan);
  return sqlite.prepare(q.sql).run(...q.params).changes;
}
async function createPlan(overrides = {}) {
  const { state, db } = planDb();
  const plan = await buildFreeVideoSubmittedNotificationPlan(db, args(overrides));
  assert.deepEqual({ reads: state.reads, writes: state.writes, prepared: state.prepared },
    { reads: 0, writes: 0, prepared: 1 }, "zero pre-batch D1 work; one deferred statement");
  return plan;
}

test("MIG-0651 notification: public core entry is identical", () => {
  assert.strictEqual(publicPlan, buildFreeVideoSubmittedNotificationPlan);
});

test("MIG-0651 notification: invalid, foreign or oversized trusted payload fails before D1 work", async () => {
  const noDb = { select() { throw Error("no D1 reads"); }, run() { throw Error("no D1 prepare"); } };
  for (const bad of [
    { videoId: "" }, { actorUserId: "" }, { eventId: "" }, { now: -1 },
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


test("MIG-0651 notification: serialized notification payload must match prevalidated host fields", async () => {
  const noDb = {
    select() { throw Error("no D1 reads"); },
    run() { throw Error("no D1 preparation"); },
  };
  const cases = [
    { ...payload(), toJSON() { return null; } },
    { ...payload(), toJSON() { return undefined; } },
    { ...payload(), toJSON() { return { ...payload(), video_id: "foreign-video" }; } },
    { ...payload(), toJSON() { return { ...payload(), url: "https://other.example/foreign" }; } },
    { ...payload(), toJSON() { return { ...payload(), content: "different notification" }; } },
    { ...payload(), toJSON() { return { ...payload(), event_id: "unrelated-event" }; } },
    { ...payload(), toJSON() { return { ...payload(), video_id: "v-test", content: null }; } },
  ];
  for (const supplied of cases) {
    await assert.rejects(
      () => buildFreeVideoSubmittedNotificationPlan(noDb, args({ payload: supplied })),
      /free_video_submitted_notification_invalid/,
      "a toJSON hook cannot bypass validated video/URL/content/event metadata",
    );
  }
  const matching = { ...payload(), toJSON() { return { ...payload() }; } };
  const accepted = await createPlan({ payload: matching });
  assert.equal(accepted.statements.length, 1,
    "a hook preserving all trusted fields remains compatible");
});

test("MIG-0651 notification: migrated SQLite commits one pending DM with no pre-batch read", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    const plan = await createPlan({ eventId: "event-a" });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
    assert.equal(execute(sqlite, plan), 1);
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

test("MIG-0651 notification: current opt-out and absent user never enqueue DM", async () => {
  const sqlite = createSqlite();
  try {
    const noUser = await createPlan();
    assert.equal(execute(sqlite, noUser), 0);
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 0 });
    const disabled = await createPlan();
    assert.equal(execute(sqlite, disabled), 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
  } finally { sqlite.close(); }
});

test("MIG-0651 notification: opt-out is rechecked inside batch, not stale preflight", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    const prepared = await createPlan();
    sqlite.prepare("UPDATE user SET is_notification_enabled=0 WHERE id='user-1'").run();
    assert.equal(execute(sqlite, prepared), 0,
      "recipient opt-out between plan creation and batch must suppress DM");
    sqlite.prepare("UPDATE user SET is_notification_enabled=1 WHERE id='user-1'").run();
    assert.equal(execute(sqlite, prepared), 1,
      "an enabled recipient is evaluated at the actual atomic write");
  } finally { sqlite.close(); }
});

test("MIG-0651 notification: pending, processing and sent dedupe; failed is reusable", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    for (const status of ["pending", "processing", "sent", "failed"]) {
      insert(sqlite, "notification_outbox", {
        id: "existing-" + status, recipient_user_id: "user-1",
        type: "video_submitted", delivery_route: "dm",
        payload_json: JSON.stringify(payload()), status,
        dedupe_key: "video_submitted:v-test", created_at: NOW,
      });
      const plan = await createPlan();
      assert.equal(execute(sqlite, plan), status === "failed" ? 1 : 0,
        status + " must preserve CURRENT active-dedupe predicate");
      sqlite.prepare("DELETE FROM notification_outbox").run();
    }
  } finally { sqlite.close(); }
});

test("MIG-0651 notification: race after prepare is deduped without an extra SELECT", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    const prepared = await createPlan();
    insert(sqlite, "notification_outbox", {
      id: "racing-id", recipient_user_id: "user-1",
      type: "video_submitted", delivery_route: "dm",
      payload_json: JSON.stringify(payload()), status: "pending",
      dedupe_key: "video_submitted:v-test", created_at: NOW,
    });
    assert.equal(execute(sqlite, prepared), 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 1);
  } finally { sqlite.close(); }
});

test("MIG-0651 notification: the video + DM outbox are rolled back together", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    const plan = await createPlan();
    sqlite.exec("BEGIN");
    try {
      insert(sqlite, "videos", {
        id: "v-test", submitted_by_user_id: "user-1",
        creator_display_name: "Test", title: "Video", youtube_video_id: "dQw4w9WgXcQ",
        visibility_status: "public",
      });
      assert.equal(execute(sqlite, plan), 1);
    } finally { sqlite.exec("ROLLBACK"); }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos WHERE id='v-test'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
  } finally { sqlite.close(); }
});

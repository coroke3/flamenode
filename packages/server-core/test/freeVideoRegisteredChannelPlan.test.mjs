import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "@flamenode/db/schema";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { buildFreeVideoRegisteredChannelPlan } from "../src/video/freeVideoRegisteredChannelPlan.ts";
import { buildFreeVideoRegisteredChannelPlan as publicPlan } from "@flamenode/server-core/video/unslottedEventPlans";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

const NOW = 1770000000;
const payload = (eventId = null) => ({
  content: "【運営通知】作品が新規登録されました",
  video_id: "v-test", url: "https://flamenode.example/v-test",
  ...(eventId ? { event_id: eventId } : {}),
});
function args(overrides = {}) {
  return { videoId: "v-test", actorUserId: "user-1", eventId: null,
    payload: payload(), threadName: "[作品登録] Title / @alice",
    now: NOW, ...overrides };
}
function dbFor(sqlite, stats) {
  return drizzle(async (query, params, method) => {
    stats.reads += 1;
    const rows = sqlite.prepare(query).all(...params);
    return { rows: method === "all" || method === "values"
      ? rows.map(row => Object.values(row)) : rows };
  }, { schema });
}

test("MIG-0651 ops notification: public entry resolves canonical builder", () => {
  assert.strictEqual(publicPlan, buildFreeVideoRegisteredChannelPlan);
});

test("MIG-0651 ops notification: invalid identity/payload fails before recipient D1 read", async () => {
  const noDb = { select() { throw Error("D1 must not be read"); } };
  for (const bad of [
    { videoId: "" },
    { actorUserId: "" },
    { now: -1 },
    { eventId: "" },
    { threadName: "  " },
    { payload: { ...payload(), video_id: "other" } },
    { payload: { ...payload(), url: "//evil.example" } },
    { payload: { ...payload(), event_id: "other" } },
    { payload: { ...payload(), content: "" } },
    { payload: { ...payload(), content: null } },
  ]) {
    await assert.rejects(() => buildFreeVideoRegisteredChannelPlan(noDb, args(bad)),
      /free_video_registered_channel_invalid/);
  }
  await assert.rejects(() => buildFreeVideoRegisteredChannelPlan(noDb,
    args({ payload: { ...payload(), content: "x".repeat(2001) } })),
    /通知 payload が不正/);
  await assert.rejects(() => buildFreeVideoRegisteredChannelPlan(noDb,
    args({ payload: { ...payload(), extra: "x".repeat(8192) } })),
    /通知 payload が不正/);
});

test("MIG-0651 ops notification: real migrated SQLite persists forced channel even when actor DM disabled", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 0 });
    const stats = { reads: 0 };
    const plan = await buildFreeVideoRegisteredChannelPlan(dbFor(sqlite, stats), args({
      eventId: "event-a", payload: payload("event-a"),
      threadName: "[作品登録] @everyone\nTitle / @here",
    }));
    assert.equal(stats.reads, 1, "force channel only reads actor row, never DM notification preference");
    assert.deepEqual(plan.expectedChanges, [null]);
    assert.equal(plan.audits.length, 0);
    assert.equal(plan.statements.length, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
    const q = plan.statements[0].toSQL();
    assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
    assert.equal(sqlite.prepare(q.sql).run(...q.params).changes, 1);
    const row = sqlite.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(row.type, "discord_webhook");
    assert.equal(row.delivery_route, "channel");
    assert.equal(row.recipient_user_id, "user-1");
    assert.equal(row.dedupe_key, "channel_video_registered:v-test");
    assert.equal(row.event_id, "event-a");
    assert.equal(row.created_at, NOW);
    assert.equal(row.status, "pending");
    const outboxPayload = JSON.parse(row.payload_json);
    assert.equal(outboxPayload.video_id, "v-test");
    assert.equal(outboxPayload.event_id, "event-a");
    assert.equal(outboxPayload.webhook_target, "event");
    assert.match(outboxPayload.thread_name, /^\[作品登録\]/);
    assert.doesNotMatch(outboxPayload.thread_name, /\r|\n|@everyone|@here/);
    assert.ok(outboxPayload.thread_name.length <= 100);
  } finally { sqlite.close(); }
});

test("MIG-0651 ops notification: missing actor still leaves CURRENT-compatible NULL channel recipient", async () => {
  const sqlite = createSqlite();
  try {
    const stats = { reads: 0 };
    const plan = await buildFreeVideoRegisteredChannelPlan(dbFor(sqlite, stats), args());
    assert.equal(stats.reads, 1);
    assert.equal(plan.statements.length, 1);
    const q = plan.statements[0].toSQL();
    assert.equal(sqlite.prepare(q.sql).run(...q.params).changes, 1);
    const row = sqlite.prepare("SELECT recipient_user_id,delivery_route FROM notification_outbox").get();
    assert.equal(row.recipient_user_id, null);
    assert.equal(row.delivery_route, "channel");
  } finally { sqlite.close(); }
});

test("MIG-0651 ops notification: CURRENT force channel race uses partial-unique conflict-ignore", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "user", { id: "user-1", is_notification_enabled: 1 });
    const stats = { reads: 0 };
    const db = dbFor(sqlite, stats);
    const plan = await buildFreeVideoRegisteredChannelPlan(db, args());
    assert.equal(stats.reads, 1);
    insert(sqlite, "notification_outbox", {
      id: "other-channel", recipient_user_id: "user-1",
      type: "discord_webhook", delivery_route: "channel",
      payload_json: JSON.stringify(payload()),
      status: "pending", dedupe_key: "channel_video_registered:v-test", created_at: NOW,
    });
    const q = plan.statements[0].toSQL();
    assert.equal(sqlite.prepare(q.sql).run(...q.params).changes, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 1);
  } finally { sqlite.close(); }
});

// MIG-0656 U02c-5d: UNMOUNTED SA-060 Hono / SQLite D1 parity candidate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { slotSingleReleaseRoutes } from "../src/routes/manage/slotSingleRelease.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ORIGIN = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", role: "admin", is_banned: 0 };
const STAFF = { id: "staff-1", role: "user", is_banned: 0 };
const columns = [
  "id", "event_id", "reserved_by_user_id", "x_user_id",
  "reserved_x_id_snapshot", "display_name", "slot_label", "start_time",
  "sort_order", "reservation_group_id", "video_id", "status",
  "updated_at", "version",
];
const slot = (id, changes = {}) => ({
  id, event_id: "ev-1", reserved_by_user_id: "recipient-1",
  x_user_id: "x1", reserved_x_id_snapshot: "x1", display_name: "Person",
  slot_label: "Keep", start_time: null, sort_order: 0,
  reservation_group_id: "group-1", video_id: null, status: "reserved",
  updated_at: 100, version: 1, ...changes,
});

function setup({ actor = ADMIN, staff = false, count = 20,
  mode = "normal", onFirst, mutate } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  seedBase(sqlite, { settings: mode });
  seedEvent(sqlite);
  sqlite.exec([
    'ALTER TABLE "user" ADD COLUMN is_notification_enabled INTEGER DEFAULT 1;',
    'INSERT INTO "user" (id,name,role,is_banned,is_tos_accepted,is_notification_enabled)',
    "VALUES ('recipient-1','Recipient','user',0,1,1);",
    'CREATE TABLE event_staff (event_id TEXT,x_user_id TEXT,permission_preset TEXT,',
    'custom_permission_keys_json TEXT);',
    'CREATE TABLE slots (id TEXT PRIMARY KEY,event_id TEXT,reserved_by_user_id TEXT,',
    'x_user_id TEXT,reserved_x_id_snapshot TEXT,display_name TEXT,slot_label TEXT,',
    'start_time INTEGER,sort_order INTEGER,reservation_group_id TEXT,video_id TEXT,',
    'status TEXT,updated_at INTEGER,version INTEGER);',
    'CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,recipient_user_id TEXT,',
    'type TEXT,payload_json TEXT,delivery_route TEXT,correlation_id TEXT,status TEXT,',
    'attempt_count INTEGER,processing_started_at INTEGER,lease_token TEXT,',
    'lease_expires_at INTEGER,next_attempt_at INTEGER,last_error TEXT,',
    'processed_at INTEGER,event_id TEXT,dedupe_key TEXT,created_at INTEGER);',
    "CREATE UNIQUE INDEX active_dedupe ON notification_outbox(dedupe_key)",
    "WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','sent');",
  ].join(" "));
  const insert = sqlite.prepare("INSERT INTO slots VALUES (" + columns.map(() => "?").join(",") + ")");
  const write = row => insert.run(...columns.map(k => row[k]));
  for (let i = 0; i < count; i += 1) write(slot("s" + i, { sort_order: i }));
  write(slot("solo", { reservation_group_id: null, reserved_by_user_id: null }));
  write(slot("submitted", { status: "submitted", reservation_group_id: null }));
  if (actor && actor.id !== ADMIN.id) {
    sqlite.prepare(
      'INSERT INTO "user"(id,name,role,is_banned,is_tos_accepted) VALUES (?,?,?,0,1)',
    ).run(actor.id, "Staff", actor.role);
  }
  if (staff && actor) {
    sqlite.prepare("INSERT INTO x_users (id,approval_status) VALUES (?,?)")
      .run("x1", "approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)")
      .run(actor.id, "x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)")
      .run("ev-1", "x1", "slot_manager", null);
  }
  mutate?.({ sqlite, write });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", actor);
    c.set("db", drizzle(c.env.DB, { schema }));
    if (actor) {
      c.set("actorSnapshotJsonById", {
        [actor.id]: JSON.stringify({ id: actor.id, role: actor.role }),
      });
    }
    await next();
  });
  // Candidate is attached ONLY inside this test, not the real manage index.
  app.route("/api/manage/events/:id/slots", slotSingleReleaseRoutes);
  const post = (id = "s0", eventId = "ev-1") => app.request(
    ORIGIN + "/api/manage/events/" + eventId + "/slots/" + id + "/release",
    { method: "POST", headers: { Origin: ORIGIN } },
    { DB: db, NEXT_PUBLIC_SITE_URL: ORIGIN },
  );
  const countRows = table => sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
  const getSlot = id => sqlite.prepare("SELECT * FROM slots WHERE id=?").get(id);
  return { sqlite, stats, post, countRows, getSlot, write };
}
test("SA-060 U02c-5d: 20 member release, 20 strict long audits, 1 DM, 3 queue intents, 1 batch", async () => {
  const s = setup();
  const res = await s.post();
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await res.json(), {
    ok: true, message: "20件の予約枠を解放しました。", pendingPublicReflection: true,
  });
  for (let i = 0; i < 20; i += 1) {
    const row = s.getSlot("s" + i);
    assert.equal(row.status, "available");
    assert.equal(row.version, 2);
    assert.equal(row.reserved_by_user_id, null);
    assert.equal(row.reservation_group_id, null);
    assert.equal(row.slot_label, "Keep");
  }
  assert.equal(s.getSlot("submitted").status, "submitted");
  assert.equal(s.countRows("audit_logs"), 20);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE retention_class='long_audit'").get().n, 20);
  assert.equal(s.countRows("notification_outbox"), 1);
  assert.match(JSON.parse(s.sqlite.prepare("SELECT payload_json FROM notification_outbox").get().payload_json).content, /予約枠 20 件/);
  assert.equal(s.countRows("static_rebuild_queue"), 3);
  assert.equal(s.stats.batches, 1);
  assert.ok(s.stats.reads <= 2);
});
test("SA-060 U02c-5d: admin and approved linked event.slots staff allowed, others denied", async () => {
  const staffDenied = setup({ actor: STAFF, count: 2 });
  assert.equal((await staffDenied.post()).status, 404);
  assert.equal(staffDenied.countRows("audit_logs"), 0);
  const staffAllowed = setup({ actor: STAFF, count: 2, staff: true });
  assert.equal((await staffAllowed.post()).status, 200);
  assert.equal(staffAllowed.countRows("audit_logs"), 2);
  const anonymous = setup({ actor: null, count: 2 });
  assert.equal((await anonymous.post()).status, 401);
  assert.equal(anonymous.countRows("audit_logs"), 0);
});
test("SA-060 U02c-5d: 21 members and mixed group state/owners fail with zero effects", async () => {
  for (const changes of [
    { status: "submitted" },
    { reserved_by_user_id: "other" },
    { x_user_id: "other" },
  ]) {
    const s = setup({ count: 2, mutate: ({ sqlite }) => {
      const key = Object.keys(changes)[0];
      sqlite.prepare("UPDATE slots SET " + key + "=? WHERE id='s1'")
        .run(changes[key]);
    } });
    const res = await s.post();
    assert.equal(res.status, 409);
    assert.equal(s.countRows("audit_logs"), 0);
    assert.equal(s.countRows("notification_outbox"), 0);
    assert.equal(s.countRows("static_rebuild_queue"), 0);
  }
  const over = setup({ count: 21 });
  assert.equal((await over.post()).status, 409);
  assert.equal(over.getSlot("s0").status, "reserved");
});
test("SA-060 U02c-5d: group phantom inserted after scoped read causes same-batch rollback", async () => {
  let injected = false;
  const s = setup({ count: 2, onFirst: (sql, db) => {
    if (!injected && sql.includes("AS group_json")) {
      injected = true;
      const stmt = db.prepare("INSERT INTO slots VALUES (" + columns.map(() => "?").join(",") + ")");
      const item = slot("phantom");
      stmt.run(...columns.map(k => item[k]));
    }
  } });
  const res = await s.post();
  assert.equal(injected, true);
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(s.getSlot("s0").status, "reserved");
  assert.equal(s.getSlot("s1").status, "reserved");
  assert.equal(s.countRows("audit_logs"), 0);
  assert.equal(s.countRows("notification_outbox"), 0);
  assert.equal(s.countRows("static_rebuild_queue"), 0);
});
test("SA-060 U02c-5d: strict audit failure rolls back slot, DM and queue", async () => {
  const s = setup({ count: 2 });
  s.sqlite.exec("DROP TABLE audit_logs");
  const res = await s.post();
  assert.equal(res.status, 503, await res.clone().text());
  for (const id of ["s0", "s1"]) assert.equal(s.getSlot(id).status, "reserved");
  assert.equal(s.countRows("notification_outbox"), 0);
  assert.equal(s.countRows("static_rebuild_queue"), 0);
});
test("SA-060 U02c-5d: opted-out recipient releases slots without DM", async () => {
  const s = setup({ count: 2 });
  s.sqlite.prepare('UPDATE "user" SET is_notification_enabled=0 WHERE id=?')
    .run("recipient-1");
  assert.equal((await s.post()).status, 200);
  assert.equal(s.countRows("audit_logs"), 2);
  assert.equal(s.countRows("notification_outbox"), 0);
});
test("SA-060 U02c-5d: CostGuard denies writes and candidate is not mounted", async () => {
  const s = setup({ mode: "maintenance", count: 2 });
  assert.equal((await s.post()).status, 503);
  assert.equal(s.countRows("audit_logs"), 0);
  const index = readFileSync(new URL("../src/routes/manage/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /slotSingleReleaseRoutes|slotSingleRelease\.ts/);
});

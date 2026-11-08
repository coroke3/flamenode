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
const SESSION_TOKEN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
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
    'CREATE TABLE "session" ("sessionToken" TEXT PRIMARY KEY, "userId" TEXT, "expires" INTEGER);',
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
  if (actor) sqlite.prepare('INSERT INTO "session" ("sessionToken","userId","expires") VALUES (?,?,?)')
    .run(SESSION_TOKEN,actor.id,Date.now()+600_000);
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
    c.set("sessionState",actor?"user":"none");
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
    { method: "POST", headers: { Origin: ORIGIN, Cookie: "__Secure-authjs.session-token=" + SESSION_TOKEN } },
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

test("SA-060 U02c-5e: stale CAS after scoped SELECT cannot partially release the group", async () => {
  let changed = false;
  const s = setup({ count: 2, onFirst: (sql, db) => {
    if (!changed && sql.includes("AS group_json")) {
      changed = true;
      db.prepare("UPDATE slots SET version = version + 1 WHERE id = ?").run("s1");
    }
  } });
  const res = await s.post();
  assert.equal(changed, true);
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(s.getSlot("s0").status, "reserved");
  assert.equal(s.getSlot("s1").status, "reserved");
  assert.equal(s.countRows("audit_logs"), 0);
  assert.equal(s.countRows("static_rebuild_queue"), 0);
  assert.equal(s.countRows("notification_outbox"), 0);
});

test("SA-060 U02c-5e: solo with a Unicode-whitespace raw group releases only its own row", async () => {
  const s = setup({ count: 2 });
  s.sqlite.prepare("UPDATE slots SET reservation_group_id = ? WHERE id IN (?,?)")
    .run("\u3000", "solo", "s0");
  const res = await s.post("solo");
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), {
    ok: true, message: "1件の予約枠を解放しました。", pendingPublicReflection: true,
  });
  assert.equal(s.getSlot("solo").status, "available");
  assert.equal(s.getSlot("s0").status, "reserved");
  assert.equal(s.countRows("audit_logs"), 1);
  assert.equal(s.countRows("notification_outbox"), 0, "owner-less solo must not enqueue a DM");
  assert.equal(s.countRows("static_rebuild_queue"), 3);
});

test("SA-060 U02c-5e: unauthorized actor sees no event existence, invalid IDs and missing slots fail closed", async () => {
  const denied = setup({ actor: STAFF, count: 2 });
  const real = await denied.post("s0", "ev-1");
  const nonexistent = await denied.post("s0", "missing");
  assert.equal(real.status, 404);
  assert.equal(nonexistent.status, 404);
  assert.equal(denied.countRows("audit_logs"), 0);
  const admin = setup({ count: 2 });
  assert.equal((await admin.post("missing")).status, 409);
  assert.equal((await admin.post("s0", "missing")).status, 404);
  assert.equal((await admin.post("invalid!")).status, 400);
  assert.equal(admin.countRows("audit_logs"), 0);
  assert.equal(admin.countRows("static_rebuild_queue"), 0);
});

test("SA-060 U04h: post-read session, staff, actor, CostGuard and event revocations roll back release",async()=>{
  for(const kind of ["session-deleted","session-expired","session-reassigned",
    "staff-revoked","tos-revoked","role-changed","banned","read-only","event-deleted"]){
    let injected=false;
    const staff=kind==="staff-revoked";
    const s=setup({actor:staff?STAFF:ADMIN,staff,count:2,onFirst:(query,sqlite)=>{
      if(injected||!query.includes("AS group_json"))return;
      injected=true;
      if(kind==="session-deleted")sqlite.prepare('DELETE FROM "session" WHERE "sessionToken"=?').run(SESSION_TOKEN);
      if(kind==="session-expired")sqlite.prepare('UPDATE "session" SET "expires"=? WHERE "sessionToken"=?')
        .run(Date.now()-60000,SESSION_TOKEN);
      if(kind==="session-reassigned")sqlite.prepare('UPDATE "session" SET "userId"=? WHERE "sessionToken"=?')
        .run("other-user",SESSION_TOKEN);
      if(kind==="staff-revoked")sqlite.prepare("UPDATE event_staff SET permission_preset='reviewer' WHERE event_id='ev-1'").run();
      if(kind==="tos-revoked")sqlite.prepare('UPDATE "user" SET is_tos_accepted=0 WHERE id=?').run(ADMIN.id);
      if(kind==="role-changed")sqlite.prepare("UPDATE \"user\" SET role='user' WHERE id=?").run(ADMIN.id);
      if(kind==="banned")sqlite.prepare('UPDATE "user" SET is_banned=1 WHERE id=?').run(ADMIN.id);
      if(kind==="read-only")sqlite.prepare("UPDATE system_settings SET operation_mode='read_only' WHERE id='default'").run();
      if(kind==="event-deleted")sqlite.prepare("DELETE FROM events WHERE id='ev-1'").run();
    }});
    try{
      const res=await s.post();
      assert.equal(injected,true,"injected post-read "+kind);
      assert.equal(res.status,409,kind+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.equal(s.getSlot("s0").status,"reserved");
      assert.equal(s.getSlot("s1").status,"reserved");
      assert.equal(s.countRows("audit_logs"),0);
      assert.equal(s.countRows("static_rebuild_queue"),0);
      assert.equal(s.countRows("notification_outbox"),0);
      assert.equal(s.stats.batches,1,"one failed atomic D1 batch");
      assert.ok(s.stats.reads<=2,"no extra scoped read");
    }finally{s.sqlite.close();}
  }
});

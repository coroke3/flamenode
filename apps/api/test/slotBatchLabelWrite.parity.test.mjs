// MIG-0656 U02c-0: unmounted Hono+node:sqlite SA-064 audit/queue/CAS proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { slotBatchLabelWriteRoutes } from "../src/routes/manage/slotBatchLabelWrite.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ORIGIN = "https://app.flamenode.example";
const SESSION_TOKEN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const admin = { id: "admin-1", role: "admin", is_banned: 0 };
const user = { id: "u-1", role: "user", is_banned: 0 };
const columns = [
  "id","event_id","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","slot_label","start_time",
  "sort_order","reservation_group_id","video_id","status","updated_at","version",
];
const makeSlot = (id, status = "available", opts = {}) => ({
  id, event_id: "ev-1", reserved_by_user_id: null, x_user_id: null,
  reserved_x_id_snapshot: null, display_name: null, slot_label: "old",
  start_time: null, sort_order: 1, reservation_group_id: null,
  video_id: null, status, updated_at: 100, version: 1, ...opts,
});
function setup({ actor = admin, staff = false, settings = "normal", onFirst = undefined } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  seedBase(sqlite, { settings });
  seedEvent(sqlite);
  sqlite.exec(`
    CREATE TABLE event_staff (event_id TEXT, x_user_id TEXT,
      permission_preset TEXT, custom_permission_keys_json TEXT);
    CREATE TABLE "session" ("sessionToken" TEXT PRIMARY KEY, "userId" TEXT, "expires" INTEGER);
    CREATE TABLE slots (
      id TEXT PRIMARY KEY, event_id TEXT, reserved_by_user_id TEXT,
      x_user_id TEXT, reserved_x_id_snapshot TEXT, display_name TEXT,
      slot_label TEXT, start_time INTEGER, sort_order INTEGER,
      reservation_group_id TEXT, video_id TEXT, status TEXT, updated_at INTEGER,
      version INTEGER
    );
  `);
  const insert = sqlite.prepare("INSERT INTO slots VALUES (" + columns.map(()=>"?").join(",") + ")");
  for (const row of [makeSlot("a"), makeSlot("b","reserved"), makeSlot("c","submitted")]) {
    insert.run(...columns.map(key => row[key]));
  }
  if (actor && actor.id !== "admin-1") {
    sqlite.prepare('INSERT INTO "user" (id,name,role,is_banned,is_tos_accepted) VALUES (?,?,?,0,1)')
      .run(actor.id, "Staff", actor.role);
  }
  if (actor) sqlite.prepare('INSERT INTO "session" ("sessionToken","userId","expires") VALUES (?,?,?)')
    .run(SESSION_TOKEN,actor.id,Date.now()+600_000);
  if (staff && actor) {
    sqlite.prepare("INSERT INTO x_users (id,approval_status) VALUES (?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)").run(actor.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)")
      .run("ev-1","x1","slot_manager",null);
  }
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", actor);
    c.set("sessionState", actor ? "user" : "none");
    c.set("db", drizzle(c.env.DB, { schema }));
    if (actor) c.set("actorSnapshotJsonById",
      { [actor.id]: JSON.stringify({id:actor.id,role:actor.role}) });
    await next();
  });
  app.route("/api/manage/events/:id/slots", slotBatchLabelWriteRoutes);
  const patch = (body = { slot_ids:["a","b"], label: "new label" }, eventId = "ev-1") =>
    app.request(ORIGIN + "/api/manage/events/" + eventId + "/slots/labels", {
      method: "PATCH", headers: { Origin:ORIGIN, "Content-Type":"application/json", Cookie:"__Secure-authjs.session-token="+SESSION_TOKEN },
      body: JSON.stringify(body),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: ORIGIN });
  const count = (table) => sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
  const slot = (id) => sqlite.prepare("SELECT * FROM slots WHERE id=?").get(id);
  return { sqlite, stats, patch, count, slot };
}

test("SA-064 U02c-0: 2-row label edit writes one audited D1 batch and full queue fanout", async () => {
  const s = setup();
  const response = await s.patch({slot_ids:["a","b","a"],label:" 新しいラベル "});
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("Cache-Control"),"private, no-store");
  assert.deepEqual(await response.json(), {
    ok:true,message:"2件のラベルを更新しました。",pendingPublicReflection:true,
  });
  for (const id of ["a","b"]) {
    const row=s.slot(id);
    assert.equal(row.slot_label,"新しいラベル");
    assert.equal(row.version,2);
  }
  assert.equal(s.slot("c").slot_label,"old");
  assert.equal(s.count("audit_logs"),2);
  assert.equal(s.count("static_rebuild_queue"),3);
  const audit=s.sqlite.prepare("SELECT * FROM audit_logs WHERE target_id='a'").get();
  assert.equal(audit.table_name,"slots");
  assert.equal(audit.operation,"UPDATE");
  assert.equal(JSON.parse(audit.before_json).slot_label,"old");
  assert.equal(JSON.parse(audit.after_json).slot_label,"新しいラベル");
  assert.equal(s.stats.batches,1);
  assert.ok(s.stats.reads<=2, "costguard+single full snapshot must fit two pre-reads in this stub");
});

test("SA-064 U02c-0: role and approved linked event.slots permission are fail closed", async () => {
  const denied=setup({actor:user});
  const no=await denied.patch();
  assert.equal(no.status,404,await no.clone().text());
  assert.equal(denied.count("audit_logs"),0);
  const allowed=setup({actor:user,staff:true});
  assert.equal((await allowed.patch()).status,200);
  assert.equal(allowed.count("audit_logs"),2);
  const anonymous=setup({actor:null});
  assert.equal((await anonymous.patch()).status,401);
  assert.equal(anonymous.count("audit_logs"),0);
});

test("SA-064 U02c-0a: admin bypasses 101-staff sentinel; non-admin refuses truncated grants", async () => {
  const fill = (s, userId) => {
    const x = s.sqlite.prepare("INSERT INTO x_users (id, approval_status) VALUES (?, 'approved')");
    const link = s.sqlite.prepare("INSERT INTO x_user_account_links VALUES (?, ?)");
    const staff = s.sqlite.prepare("INSERT INTO event_staff VALUES (?, ?, ?, ?)");
    for (let i = 0; i < 101; i += 1) {
      const id = "oversize-x-" + i;
      x.run(id);
      link.run(userId, id);
      staff.run("ev-1", id, "slot_manager", null);
    }
  };
  const privileged = setup();
  fill(privileged, "admin-1");
  const adminRes = await privileged.patch();
  assert.equal(adminRes.status, 200, await adminRes.clone().text());
  assert.equal(privileged.count("audit_logs"), 2);
  const ordinary = setup({actor:user});
  fill(ordinary, "u-1");
  const denied = await ordinary.patch();
  assert.equal(denied.status, 503, await denied.clone().text());
  assert.equal(ordinary.count("audit_logs"), 0);
  assert.equal(ordinary.count("static_rebuild_queue"), 0);
});

test("SA-064 U02c-0: malformed input, too many IDs, missing event do not write", async () => {
  const s=setup();
  for(const [body,id,expected] of [
    [{slot_ids:[],label:"ok"},"ev-1",400],
    [{slot_ids:["a","b","c","d"],label:"ok"},"ev-1",400],
    [{slot_ids:["a"],label:" "},"ev-1",400],
    [{slot_ids:["a"],label:"valid"},"other",404],
    [{slot_ids:["not-a-slot"],label:"valid"},"ev-1",409],
  ]) {
    const response=await s.patch(body,id);
    assert.equal(response.status,expected,await response.clone().text());
  }
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});

test("SA-064 U02c-0: D1 strict-audit failure atomically rolls back slots and queue", async () => {
  const s=setup();
  s.sqlite.exec("DROP TABLE audit_logs");
  const r=await s.patch();
  assert.equal(r.status,503,await r.clone().text());
  assert.equal(s.slot("a").slot_label,"old");
  assert.equal(s.slot("b").slot_label,"old");
  assert.equal(s.count("static_rebuild_queue"),0);
});

test("SA-064 U02c-0: stale CAS read rolls back all changes", async () => {
  let fired=false;
  const s=setup({onFirst:(sql, sqlite)=>{
    if(!fired && sql.includes("AS slots_json")) {
      fired=true;
      sqlite.prepare("UPDATE slots SET version=version+1 WHERE id='b'").run();
    }
  }});
  const r=await s.patch();
  assert.equal(r.status,409,await r.clone().text());
  assert.equal(s.slot("a").slot_label,"old");
  assert.equal(s.slot("b").slot_label,"old");
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});

test("SA-064 U02c-0: CostGuard maintenance rejects before slot snapshot or DML", async () => {
  const s=setup({settings:"maintenance"});
  const response=await s.patch();
  assert.equal(response.status,503);
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});


test("SA-064 U04e: session, staff grant, TOS and CostGuard revocations after scope SELECT abort the atomic label batch", async () => {
  for (const kind of ["session-deleted","session-expired","session-reassigned",
    "staff-revoked","tos-revoked","role-changed","banned","cost-guard-read-only","event-deleted"]) {
    let changed = false;
    const staff = kind === "staff-revoked";
    const s = setup({actor:staff ? user : admin, staff, onFirst:(sql,sqlite)=>{
      // This hook executes after the original authorized SELECT returns its
      // old snapshot. The next query is the SAME transactional D1 batch.
      if (changed || !sql.includes("AS slots_json")) return;
      changed = true;
      if (kind === "session-deleted") sqlite.prepare('DELETE FROM "session" WHERE "sessionToken"=?').run(SESSION_TOKEN);
      if (kind === "session-expired") sqlite.prepare('UPDATE "session" SET "expires"=? WHERE "sessionToken"=?')
        .run(Date.now()-60_000,SESSION_TOKEN);
      if (kind === "session-reassigned") sqlite.prepare('UPDATE "session" SET "userId"=? WHERE "sessionToken"=?')
        .run("other-user",SESSION_TOKEN);
      if (kind === "staff-revoked") sqlite.prepare("UPDATE event_staff SET permission_preset='reviewer' WHERE event_id='ev-1'").run();
      if (kind === "tos-revoked") sqlite.prepare('UPDATE "user" SET is_tos_accepted=0 WHERE id=?').run("admin-1");
      if (kind === "role-changed") sqlite.prepare('UPDATE "user" SET role=\'user\' WHERE id=?').run("admin-1");
      if (kind === "banned") sqlite.prepare('UPDATE "user" SET is_banned=1 WHERE id=?').run("admin-1");
      if (kind === "cost-guard-read-only") sqlite.prepare("UPDATE system_settings SET operation_mode='read_only' WHERE id='default'").run();
      if (kind === "event-deleted") sqlite.prepare("DELETE FROM events WHERE id='ev-1'").run();
    }});
    try {
      const response = await s.patch();
      assert.equal(changed,true,"after-scope race hook "+kind);
      assert.equal(response.status,409,kind+" "+await response.clone().text());
      assert.equal(response.headers.get("Cache-Control"),"private, no-store");
      assert.equal(s.slot("a").slot_label,"old");
      assert.equal(s.slot("b").slot_label,"old");
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1,"one rolled-back D1 batch "+kind);
      assert.ok(s.stats.reads<=2,"no new pre-read "+kind);
    } finally {s.sqlite.close();}
  }
});

test("SA-064 U02c-0: the write candidate is deliberately NOT mounted in manage index", () => {
  const source=readFileSync(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/slotBatchLabelWriteRoutes|slotBatchLabelWrite\.ts/);
});

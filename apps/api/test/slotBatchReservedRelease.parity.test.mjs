// MIG-0656 U02c-3: unmounted SA-063 release Hono + atomic D1 stub parity.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { slotBatchReservedReleaseRoutes } from "../src/routes/manage/slotBatchReservedRelease.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ORIGIN="https://app.flamenode.example";
const ADMIN={id:"admin-1",role:"admin",is_banned:0};
const STAFF={id:"staff-1",role:"user",is_banned:0};
const cols=["id","event_id","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","slot_label","start_time",
  "sort_order","reservation_group_id","video_id","status","updated_at","version"];
const slot=(id,props={})=>({
  id,event_id:"ev-1",reserved_by_user_id:"recipient-1",x_user_id:"x1",
  reserved_x_id_snapshot:"x1",display_name:"Person",slot_label:"Keep",
  start_time:null,sort_order:0,reservation_group_id:"group-1",
  video_id:null,status:"reserved",updated_at:100,version:1,...props,
});

function setup({actor=ADMIN,staff=false,mode="normal",onFirst,mutate}={}) {
  const {db,sqlite,stats}=createAdminD1({onFirst});
  seedBase(sqlite,{settings:mode});
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
  const insert=sqlite.prepare("INSERT INTO slots VALUES ("+cols.map(()=>"?").join(",")+")");
  const initial=[
    slot("a"),slot("b"),
    slot("solo",{reservation_group_id:null,reserved_by_user_id:null}),
    slot("submitted",{status:"submitted",reservation_group_id:null}),
  ];
  for(const item of initial)insert.run(...cols.map(key=>item[key]));
  if(actor && actor.id!=="admin-1")sqlite.prepare(
    'INSERT INTO "user"(id,name,role,is_banned,is_tos_accepted) VALUES (?,?,?,0,1)'
  ).run(actor.id,"Staff",actor.role);
  if(staff && actor){
    sqlite.prepare("INSERT INTO x_users (id,approval_status) VALUES (?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)").run(actor.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)").run(
      "ev-1","x1","slot_manager",null);
  }
  mutate?.({sqlite,insert});
  const app=new Hono();
  app.use("*",async(c,next)=>{
    c.set("user",actor);
    c.set("db",drizzle(c.env.DB,{schema}));
    if(actor)c.set("actorSnapshotJsonById",{
      [actor.id]:JSON.stringify({id:actor.id,role:actor.role}),
    });
    await next();
  });
  app.route("/api/manage/events/:id/slots",slotBatchReservedReleaseRoutes);
  const post=(body={slot_ids:["a"]},eventId="ev-1")=>app.request(
    ORIGIN+"/api/manage/events/"+eventId+"/slots/batch-release",{
      method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/json"},
      body:JSON.stringify(body),
    },{DB:db,NEXT_PUBLIC_SITE_URL:ORIGIN}
  );
  const count=(name)=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+name).get().n;
  const getSlot=(id)=>sqlite.prepare("SELECT * FROM slots WHERE id=?").get(id);
  return {sqlite,stats,post,count,getSlot,insert};
}
test("SA-063 U02c-3: release whole group, 2 long audits, 1 DM and 3 projections in one batch",async()=>{
  const s=setup();
  const response=await s.post({slot_ids:["a"]});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get("Cache-Control"),"private, no-store");
  assert.deepEqual(await response.json(),{
    ok:true,message:"2件の予約枠を解放しました。",pendingPublicReflection:true,
  });
  for(const id of ["a","b"]){
    const row=s.getSlot(id);
    assert.equal(row.status,"available");
    assert.equal(row.version,2);
    assert.equal(row.reserved_by_user_id,null);
    assert.equal(row.reservation_group_id,null);
    assert.equal(row.slot_label,"Keep");
  }
  assert.equal(s.getSlot("submitted").status,"submitted");
  assert.equal(s.count("audit_logs"),2);
  assert.equal(s.count("static_rebuild_queue"),3);
  assert.equal(s.count("notification_outbox"),1);
  const row=s.sqlite.prepare("SELECT * FROM notification_outbox").get();
  assert.equal(row.type,"slot_force_released");
  assert.match(JSON.parse(row.payload_json).content,/予約枠 2 件/);
  assert.equal(s.sqlite.prepare("SELECT retention_class FROM audit_logs LIMIT 1").get().retention_class,"long_audit");
  assert.equal(s.stats.batches,1);
  assert.ok(s.stats.reads<=2,"CostGuard + one scoped group snapshot only");
});
test("SA-063 U02c-3: unauthorized and anonymous users never release or notify",async()=>{
  const denied=setup({actor:STAFF});
  assert.equal((await denied.post()).status,404);
  assert.equal(denied.count("audit_logs"),0);
  const allowed=setup({actor:STAFF,staff:true});
  assert.equal((await allowed.post()).status,200);
  assert.equal(allowed.count("notification_outbox"),1);
  const anon=setup({actor:null});
  assert.equal((await anon.post()).status,401);
  assert.equal(anon.count("notification_outbox"),0);
});
test("SA-063 U02c-3: mixed owners/status, overlimit, missing IDs fail without effects",async()=>{
  for(const mutate of [
    ({sqlite})=>sqlite.prepare("UPDATE slots SET reserved_by_user_id='other' WHERE id='b'").run(),
    ({sqlite})=>sqlite.prepare("UPDATE slots SET status='submitted' WHERE id='b'").run(),
    ({sqlite,insert})=>{
      for(const id of ["c","d"])insert.run(...cols.map(key=>slot(id)[key]));
    },
  ]){
    const s=setup({mutate});
    const response=await s.post();
    assert.equal(response.status,409,await response.clone().text());
    assert.equal(s.count("audit_logs"),0);
    assert.equal(s.count("notification_outbox"),0);
    assert.equal(s.count("static_rebuild_queue"),0);
  }
  const s=setup();
  for(const body of [{slot_ids:[]},{slot_ids:["missing"]},{slot_ids:["a","b","solo","submitted"]}]){
    const response=await s.post(body);
    assert.notEqual(response.status,200);
  }
  assert.equal(s.count("audit_logs"),0);
});
test("SA-063 U02c-3: phantom group member inserted after read triggers same-batch refusal",async()=>{
  let inserted=false;
  const s=setup({onFirst:(query,sqlite)=>{
    if(!inserted && query.includes("AS grouped_slots_json")){
      inserted=true;
      const stmt=sqlite.prepare("INSERT INTO slots VALUES ("+cols.map(()=>"?").join(",")+")");
      const extra=slot("phantom");
      stmt.run(...cols.map(key=>extra[key]));
    }
  }});
  const response=await s.post();
  assert.equal(inserted,true);
  assert.equal(response.status,409,await response.clone().text());
  assert.equal(s.getSlot("a").status,"reserved");
  assert.equal(s.getSlot("b").status,"reserved");
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("notification_outbox"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});
test("SA-063 U02c-3: strict audit failure rolls back slot release, projections and DM",async()=>{
  const s=setup();
  s.sqlite.exec("DROP TABLE audit_logs");
  const response=await s.post();
  assert.equal(response.status,503,await response.clone().text());
  assert.equal(s.getSlot("a").status,"reserved");
  assert.equal(s.getSlot("b").status,"reserved");
  assert.equal(s.count("static_rebuild_queue"),0);
  assert.equal(s.count("notification_outbox"),0);
});
test("SA-063 U02c-3: notification opt-out does not block valid slot release",async()=>{
  const s=setup();
  s.sqlite.prepare("UPDATE \"user\" SET is_notification_enabled=0 WHERE id='recipient-1'").run();
  const response=await s.post();
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(s.count("notification_outbox"),0);
  assert.equal(s.count("audit_logs"),2);
});
test("SA-063 U02c-3: CostGuard blocks and production router does not mount this candidate",async()=>{
  const s=setup({mode:"maintenance"});
  assert.equal((await s.post()).status,503);
  assert.equal(s.count("notification_outbox"),0);
  const index=readFileSync(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotBatchReservedReleaseRoutes|slotBatchReservedRelease\.ts/);
});

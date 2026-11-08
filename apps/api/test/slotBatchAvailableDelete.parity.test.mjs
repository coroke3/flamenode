// MIG-0656 U02c-1: unmounted SA-062 Hono+SQLite D1 parity.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { slotBatchAvailableDeleteRoutes } from "../src/routes/manage/slotBatchAvailableDelete.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ORIGIN="https://app.flamenode.example";
const admin={id:"admin-1",role:"admin",is_banned:0};
const user={id:"viewer",role:"user",is_banned:0};
const columns=["id","event_id","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","slot_label","start_time","sort_order",
  "reservation_group_id","video_id","status","updated_at","version"];
const makeRow=(id,status="available")=>({
  id,event_id:"ev-1",reserved_by_user_id:null,x_user_id:null,
  reserved_x_id_snapshot:null,display_name:null,slot_label:"keep",
  start_time:null,sort_order:0,reservation_group_id:null,video_id:null,
  status,updated_at:100,version:1,
});

function setup({actor=admin,staff=false,settings="normal",onFirst}={}) {
  const {db,sqlite,stats}=createAdminD1({onFirst});
  seedBase(sqlite,{settings});
  seedEvent(sqlite);
  sqlite.exec(`
    CREATE TABLE event_staff (event_id TEXT,x_user_id TEXT,permission_preset TEXT,
      custom_permission_keys_json TEXT);
    CREATE TABLE slots (
      id TEXT PRIMARY KEY,event_id TEXT,reserved_by_user_id TEXT,x_user_id TEXT,
      reserved_x_id_snapshot TEXT,display_name TEXT,slot_label TEXT,start_time INTEGER,
      sort_order INTEGER,reservation_group_id TEXT,video_id TEXT,status TEXT,
      updated_at INTEGER,version INTEGER
    );
  `);
  const insert=sqlite.prepare("INSERT INTO slots VALUES ("+columns.map(()=>"?").join(",")+")");
  for(const row of [makeRow("a"),makeRow("b"),makeRow("reserved","reserved"),makeRow("submitted","submitted")]) {
    insert.run(...columns.map(key=>row[key]));
  }
  if(actor && actor.id!=="admin-1")sqlite.prepare(
    'INSERT INTO "user" (id,name,role,is_banned,is_tos_accepted) VALUES (?,?,?,0,1)'
  ).run(actor.id,"Viewer",actor.role);
  if(staff && actor){
    sqlite.prepare("INSERT INTO x_users (id,approval_status) VALUES (?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)").run(actor.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)").run("ev-1","x1","slot_manager",null);
  }
  const app=new Hono();
  app.use("*",async(c,next)=>{
    c.set("user",actor);
    c.set("db",drizzle(c.env.DB,{schema}));
    if(actor)c.set("actorSnapshotJsonById",{[actor.id]:JSON.stringify({id:actor.id,role:actor.role})});
    await next();
  });
  app.route("/api/manage/events/:id/slots",slotBatchAvailableDeleteRoutes);
  const del=(body={slot_ids:["a","b"]},eventId="ev-1")=>app.request(
    ORIGIN+"/api/manage/events/"+eventId+"/slots/batch-delete",{
      method:"POST",
      headers:{Origin:ORIGIN,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    },{DB:db,NEXT_PUBLIC_SITE_URL:ORIGIN}
  );
  const count=(table)=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
  const slot=(id)=>sqlite.prepare("SELECT * FROM slots WHERE id=?").get(id);
  return {sqlite,stats,del,count,slot};
}

test("SA-062 U02c-1: delete two slots with strict audits and 3 projection targets in one D1 batch",async()=>{
  const s=setup(),r=await s.del({slot_ids:["a","b","a"]});
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(r.headers.get("Cache-Control"),"private, no-store");
  assert.deepEqual(await r.json(),{
    ok:true,created:2,message:"2件の枠を削除しました。",pendingPublicReflection:true,
  });
  assert.equal(s.slot("a"),undefined);
  assert.equal(s.slot("b"),undefined);
  assert.equal(s.slot("reserved").status,"reserved");
  assert.equal(s.slot("submitted").status,"submitted");
  assert.equal(s.count("audit_logs"),2);
  assert.equal(s.count("static_rebuild_queue"),3);
  for(const audit of s.sqlite.prepare("SELECT * FROM audit_logs ORDER BY target_id").all()){
    assert.equal(audit.operation,"DELETE");
    assert.equal(audit.table_name,"slots");
    assert.equal(JSON.parse(audit.before_json).status,"available");
  }
  assert.equal(s.stats.batches,1);
  assert.ok(s.stats.reads<=2,"CostGuard+bounded event/staff/rows query");
});

test("SA-062 U02c-1: unauthorized, anonymous and approved linked slot manager",async()=>{
  const denied=setup({actor:user});
  const d=await denied.del();
  assert.equal(d.status,404,await d.clone().text());
  assert.equal(denied.count("audit_logs"),0);
  const allowed=setup({actor:user,staff:true});
  assert.equal((await allowed.del()).status,200);
  const anon=setup({actor:null});
  assert.equal((await anon.del()).status,401);
});

test("SA-062 U02c-1: invalid, mixed, over-limit and foreign-event requests leave DB intact",async()=>{
  const s=setup();
  for(const [body,eventId,status] of [
    [{slot_ids:[]},"ev-1",400],
    [{slot_ids:["a","b","reserved","submitted"]},"ev-1",400],
    [{slot_ids:["a","reserved"]},"ev-1",409],
    [{slot_ids:["missing"]},"ev-1",409],
    [{slot_ids:["a"]},"other",404]
  ]){
    const r=await s.del(body,eventId);
    assert.equal(r.status,status,await r.clone().text());
  }
  assert.equal(s.count("slots"),4);
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});

test("SA-062 U02c-1: strict audit insert error rolls back deletion and queue",async()=>{
  const s=setup();
  s.sqlite.exec("DROP TABLE audit_logs");
  const r=await s.del();
  assert.equal(r.status,503,await r.clone().text());
  assert.ok(s.slot("a"));
  assert.ok(s.slot("b"));
  assert.equal(s.count("static_rebuild_queue"),0);
});

test("SA-062 U02c-1: concurrent status flip aborts entire CAS mutation",async()=>{
  let ran=false;
  const s=setup({onFirst:(sql,sqlite)=>{
    if(!ran&&sql.includes("AS slots_json")){
      ran=true;
      sqlite.prepare("UPDATE slots SET status='reserved' WHERE id='b'").run();
    }
  }});
  const r=await s.del();
  assert.equal(r.status,409,await r.clone().text());
  assert.ok(s.slot("a"));
  assert.equal(s.slot("b").status,"reserved");
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});

test("SA-062 U02c-1: CostGuard blocks deletion and this candidate is NOT mounted",async()=>{
  const s=setup({settings:"maintenance"});
  assert.equal((await s.del()).status,503);
  assert.equal(s.count("audit_logs"),0);
  const index=readFileSync(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotBatchAvailableDeleteRoutes|slotBatchAvailableDelete\.ts/);
});

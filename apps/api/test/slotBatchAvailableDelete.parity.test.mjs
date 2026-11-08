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
const SESSION_TOKEN="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
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
    CREATE TABLE "session" ("sessionToken" TEXT PRIMARY KEY, "userId" TEXT, "expires" INTEGER);
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
  if(actor) sqlite.prepare('INSERT INTO "session" ("sessionToken","userId","expires") VALUES (?,?,?)')
    .run(SESSION_TOKEN,actor.id,Date.now()+600_000);
  if(staff && actor){
    sqlite.prepare("INSERT INTO x_users (id,approval_status) VALUES (?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)").run(actor.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)").run("ev-1","x1","slot_manager",null);
  }
  const app=new Hono();
  app.use("*",async(c,next)=>{
    c.set("user",actor);
    c.set("sessionState",actor?"user":"none");
    c.set("db",drizzle(c.env.DB,{schema}));
    if(actor)c.set("actorSnapshotJsonById",{[actor.id]:JSON.stringify({id:actor.id,role:actor.role})});
    await next();
  });
  app.route("/api/manage/events/:id/slots",slotBatchAvailableDeleteRoutes);
  const del=(body={slot_ids:["a","b"]},eventId="ev-1")=>app.request(
    ORIGIN+"/api/manage/events/"+eventId+"/slots/batch-delete",{
      method:"POST",
      headers:{Origin:ORIGIN,"Content-Type":"application/json",Cookie:"__Secure-authjs.session-token="+SESSION_TOKEN},
      body:JSON.stringify(body)
    },{DB:db,NEXT_PUBLIC_SITE_URL:ORIGIN}
  );
  const deleteOne=(id="a",eventId="ev-1")=>app.request(
    ORIGIN+"/api/manage/events/"+eventId+"/slots/"+id,{
      method:"DELETE",headers:{Origin:ORIGIN,Cookie:"__Secure-authjs.session-token="+SESSION_TOKEN},
    },{DB:db,NEXT_PUBLIC_SITE_URL:ORIGIN}
  );
  const count=(table)=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
  const slot=(id)=>sqlite.prepare("SELECT * FROM slots WHERE id=?").get(id);
  return {sqlite,stats,del,deleteOne,count,slot};
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

test("SA-061 U02c-4: single available delete with strict audit and 3 projections",async()=>{
  const s=setup(),r=await s.deleteOne("a");
  assert.equal(r.status,200,await r.clone().text());
  assert.deepEqual(await r.json(),{
    ok:true,created:1,message:"1件の枠を削除しました。",pendingPublicReflection:true,
  });
  assert.equal(s.slot("a"),undefined);
  assert.ok(s.slot("b"));
  assert.equal(s.slot("reserved").status,"reserved");
  assert.equal(s.count("audit_logs"),1);
  assert.equal(s.count("static_rebuild_queue"),3);
  const audit=s.sqlite.prepare("SELECT operation,retention_class,before_json FROM audit_logs").get();
  assert.equal(audit.operation,"DELETE");
  assert.equal(audit.retention_class,"normal");
  assert.equal(JSON.parse(audit.before_json).id,"a");
  assert.equal(s.stats.batches,1);
});
test("SA-061 U02c-4: reserved, submitted, missing, foreign and invalid IDs fail closed",async()=>{
  const s=setup();
  for(const [id,event,status] of [
    ["reserved","ev-1",409],["submitted","ev-1",409],
    ["missing","ev-1",409],["a","other",404],
    ["bad id","ev-1",400]
  ]){
    const r=await s.deleteOne(id,event);
    assert.equal(r.status,status,id+" "+await r.clone().text());
  }
  assert.equal(s.count("slots"),4);
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});
test("SA-061 U02c-4: staff privileges, identity and maintenance guards",async()=>{
  const denied=setup({actor:user});
  assert.equal((await denied.deleteOne()).status,404);
  const approved=setup({actor:user,staff:true});
  assert.equal((await approved.deleteOne()).status,200);
  assert.equal(approved.count("audit_logs"),1);
  const anon=setup({actor:null});
  assert.equal((await anon.deleteOne()).status,401);
  const maintenance=setup({settings:"maintenance"});
  assert.equal((await maintenance.deleteOne()).status,503);
  assert.equal(maintenance.count("audit_logs"),0);
});
test("SA-061 U02c-4: postread status race aborts CAS delete, audit and queue",async()=>{
  let raced=false;
  const s=setup({onFirst:(sql,sqlite)=>{
    if(!raced&&sql.includes("AS slots_json")){
      raced=true;
      sqlite.prepare("UPDATE slots SET status='reserved' WHERE id='a'").run();
    }
  }});
  const r=await s.deleteOne();
  assert.equal(raced,true);
  assert.equal(r.status,409,await r.clone().text());
  assert.equal(s.slot("a").status,"reserved");
  assert.equal(s.count("audit_logs"),0);
  assert.equal(s.count("static_rebuild_queue"),0);
});
test("SA-061 U02c-4: audit error rolls back single deletion and queue",async()=>{
  const s=setup();
  s.sqlite.exec("DROP TABLE audit_logs");
  assert.equal((await s.deleteOne()).status,503);
  assert.ok(s.slot("a"));
  assert.equal(s.count("static_rebuild_queue"),0);
});

test("SA-061/062 U04f: revoked parent authorization after scope read rolls back both deletion forms",async()=>{
  for(const method of ["single","batch"]){
    for(const kind of ["session-deleted","session-expired","session-reassigned",
      "staff-revoked","tos-revoked","role-changed","banned","read-only","event-deleted"]){
      let injected=false;
      const staff=kind==="staff-revoked";
      const s=setup({actor:staff?user:admin,staff,onFirst:(sql,sqlite)=>{
        if(injected||!sql.includes("AS slots_json"))return;
        injected=true;
        if(kind==="session-deleted") sqlite.prepare('DELETE FROM "session" WHERE "sessionToken"=?').run(SESSION_TOKEN);
        if(kind==="session-expired") sqlite.prepare('UPDATE "session" SET "expires"=? WHERE "sessionToken"=?')
          .run(Date.now()-60000,SESSION_TOKEN);
        if(kind==="session-reassigned") sqlite.prepare('UPDATE "session" SET "userId"=? WHERE "sessionToken"=?')
          .run("other-user",SESSION_TOKEN);
        if(kind==="staff-revoked") sqlite.prepare("UPDATE event_staff SET permission_preset='reviewer' WHERE event_id='ev-1'").run();
        if(kind==="tos-revoked") sqlite.prepare('UPDATE "user" SET is_tos_accepted=0 WHERE id=?').run("admin-1");
        if(kind==="role-changed") sqlite.prepare("UPDATE \"user\" SET role='user' WHERE id=?").run("admin-1");
        if(kind==="banned") sqlite.prepare('UPDATE "user" SET is_banned=1 WHERE id=?').run("admin-1");
        if(kind==="read-only") sqlite.prepare("UPDATE system_settings SET operation_mode='read_only' WHERE id='default'").run();
        if(kind==="event-deleted") sqlite.prepare("DELETE FROM events WHERE id='ev-1'").run();
      }});
      try{
        const r=method==="single"?await s.deleteOne("a"):await s.del();
        assert.equal(injected,true,"injected post-scope race "+method+" "+kind);
        assert.equal(r.status,409,method+" "+kind+" "+await r.clone().text());
        assert.equal(r.headers.get("Cache-Control"),"private, no-store");
        assert.ok(s.slot("a"),"original slot a retained");
        assert.ok(s.slot("b"),"original slot b retained");
        assert.equal(s.count("audit_logs"),0);
        assert.equal(s.count("static_rebuild_queue"),0);
        assert.equal(s.stats.batches,1,"single failed atomic batch");
        assert.ok(s.stats.reads<=2,"no additional D1 preread");
      }finally{s.sqlite.close();}
    }
  }
});


test("MIG-0656 U04r: post-scope linked-X revocation and major-TOS publication roll back SA-061/062",async()=>{
  for(const method of ["single","batch"]){
    for(const kind of ["x-approval-revoked","major-terms-published"]){
      const staff=kind==="x-approval-revoked";
      let injected=false;
      const s=setup({actor:staff?user:admin,staff,onFirst:(sql,sqlite)=>{
        if(injected||!sql.includes("AS slots_json"))return;
        injected=true;
        if(kind==="x-approval-revoked"){
          sqlite.prepare("UPDATE x_users SET approval_status='pending' WHERE id='x1'").run();
        }else{
          sqlite.prepare("INSERT INTO terms_versions(id,severity,published_at,updated_at) VALUES (?,?,?,?)")
            .run("major-new","major",Math.floor(Date.now()/1000),Math.floor(Date.now()/1000));
        }
      }});
      try{
        const r=method==="single"?await s.deleteOne("a"):await s.del();
        assert.equal(injected,true,method+" "+kind+" injected");
        assert.equal(r.status,409,method+" "+kind+" "+await r.clone().text());
        assert.equal(r.headers.get("Cache-Control"),"private, no-store");
        for(const id of ["a","b"]){
          assert.equal(s.slot(id).status,"available");
          assert.equal(s.slot(id).version,1);
        }
        assert.equal(s.count("audit_logs"),0);
        assert.equal(s.count("static_rebuild_queue"),0);
        assert.equal(s.stats.batches,1,"one rolled-back D1 batch");
        assert.ok(s.stats.reads<=2,"no additional scoped prereads");
      }finally{s.sqlite.close();}
    }
  }
});

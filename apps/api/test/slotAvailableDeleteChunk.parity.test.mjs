// MIG-0656 U03n SA-059 one-chunk Hono+SQLite D1, TEST-ONLY mounted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { slotAvailableDeleteChunkRoutes } from "../src/routes/manage/slotAvailableDeleteChunk.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ORIGIN="https://app.flamenode.example";
const ADMIN={id:"admin-1",role:"admin",is_banned:0};
const VIEWER={id:"viewer",role:"user",is_banned:0};
const columns=["id","event_id","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","slot_label","start_time",
  "sort_order","reservation_group_id","video_id","status","updated_at","version"];
const row=(id,status="available")=>({
  id,event_id:"ev-1",reserved_by_user_id:null,x_user_id:null,
  reserved_x_id_snapshot:null,display_name:null,slot_label:"Keep",
  start_time:null,sort_order:0,reservation_group_id:null,video_id:null,
  status,updated_at:100,version:1,
});
function setup({ids=["a","b","c","d","e","f"],actor=ADMIN,staff=false,
  mode="normal",onFirst}={}){
  const {db,sqlite,stats}=createAdminD1({onFirst});
  seedBase(sqlite,{settings:mode});
  seedEvent(sqlite);
  sqlite.exec([
    "CREATE TABLE event_staff(event_id TEXT,x_user_id TEXT,permission_preset TEXT,custom_permission_keys_json TEXT);",
    "CREATE TABLE slots("+columns.map(k=>k==="id"?"id TEXT PRIMARY KEY":
      ["start_time","sort_order","updated_at","version"].includes(k)?
      k+" INTEGER":k+" TEXT").join(",")+");",
  ].join(" "));
  const insert=sqlite.prepare("INSERT INTO slots VALUES("+columns.map(()=>"?").join(",")+")");
  const add=(r)=>insert.run(...columns.map(k=>r[k]));
  for(const id of ids)add(row(id));
  if(actor&&actor.id!==ADMIN.id){
    sqlite.prepare('INSERT INTO "user"(id,name,role,is_banned,is_tos_accepted) VALUES(?,?,?,0,1)')
      .run(actor.id,"Viewer",actor.role);
  }
  if(staff&&actor){
    sqlite.prepare("INSERT INTO x_users(id,approval_status) VALUES(?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES(?,?)").run(actor.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES(?,?,?,?)")
      .run("ev-1","x1","slot_manager",null);
  }
  const app=new Hono();
  app.use("*",async(c,next)=>{
    c.set("user",actor);
    c.set("db",drizzle(c.env.DB,{schema}));
    if(actor)c.set("actorSnapshotJsonById",{
      [actor.id]:JSON.stringify({id:actor.id,role:actor.role}),
    });
    await next();
  });
  // The production parent manage/index.ts must NOT attach this route.
  app.route("/api/manage/events/:id/slots",slotAvailableDeleteChunkRoutes);
  const post=(event="ev-1")=>app.request(
    ORIGIN+"/api/manage/events/"+event+"/slots/delete-available-chunk",
    {method:"POST",headers:{Origin:ORIGIN}},
    {DB:db,NEXT_PUBLIC_SITE_URL:ORIGIN},
  );
  const slot=(id)=>sqlite.prepare("SELECT * FROM slots WHERE id=?").get(id);
  const idsLeft=()=>sqlite.prepare("SELECT id FROM slots ORDER BY id").all().map(x=>x.id);
  const count=(table)=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
  return {sqlite,stats,post,slot,add,idsLeft,count};
}

test("SA-059 U03n: each authorized POST deletes only three rows; never asserts whole-event completion",async()=>{
  const s=setup();
  try{
    const first=await s.post();
    assert.equal(first.status,200,await first.clone().text());
    assert.equal(first.headers.get("Cache-Control"),"private, no-store");
    assert.deepEqual(await first.json(),{
      ok:true,deletedThisChunk:3,moreAtSnapshot:true,
      completionVerified:false,pendingPublicReflection:true,
    });
    assert.deepEqual(s.idsLeft(),["d","e","f"]);
    assert.equal(s.count("audit_logs"),3);
    assert.equal(s.count("static_rebuild_queue"),3);
    assert.equal(s.stats.batches,1);
    const second=await s.post();
    assert.equal(second.status,200,await second.clone().text());
    assert.deepEqual(await second.json(),{
      ok:true,deletedThisChunk:3,moreAtSnapshot:false,
      completionVerified:false,pendingPublicReflection:true,
    });
    assert.deepEqual(s.idsLeft(),[]);
    assert.equal(s.count("audit_logs"),6);
    assert.equal(s.stats.batches,2,"one audited batch per POST");
    // Queue dedupe is allowed, but the second mutation must not enqueue
    // more than the same three distinct projection targets.
    assert.equal(s.count("static_rebuild_queue"),3);
    const repeated=await s.post();
    assert.equal(repeated.status,409,await repeated.clone().text());
    assert.equal(s.count("audit_logs"),6);
    assert.equal(s.stats.batches,2);
    for(const a of s.sqlite.prepare("SELECT * FROM audit_logs").all()){
      assert.equal(a.operation,"DELETE");
      assert.equal(a.table_name,"slots");
      assert.equal(a.retention_class,"normal");
      assert.equal(JSON.parse(a.before_json).status,"available");
    }
    const reasons=s.sqlite.prepare("SELECT reason FROM static_rebuild_queue").all();
    assert.ok(reasons.every(r=>r.reason==="slot_admin_delete_available"));
  }finally{s.sqlite.close();}
});

test("SA-059 U03u: CostGuard changes between chunks block the next delete",async()=>{
  for(const block of [
    {column:"operation_mode",value:"read_only",reason:"maintenance_mode"},
    {column:"disabled_features_json",value:'["manage_slot_delete"]',reason:"cost_guard_blocked"},
  ]){
    const s=setup();
    try{
      const first=await s.post();
      assert.equal(first.status,200,await first.clone().text());
      assert.deepEqual(s.idsLeft(),["d","e","f"]);
      assert.equal(s.stats.batches,1);
      s.sqlite.prepare("UPDATE system_settings SET "+block.column+"=? WHERE id='default'").run(block.value);
      const denied=await s.post();
      assert.equal(denied.status,503,await denied.clone().text());
      assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
      assert.equal((await denied.json()).reason,block.reason);
      assert.deepEqual(s.idsLeft(),["d","e","f"]);
      assert.equal(s.count("audit_logs"),3);
      assert.equal(s.count("static_rebuild_queue"),3);
      assert.equal(s.stats.batches,1,"second request must not attempt D1 mutation");
    }finally{s.sqlite.close();}
  }
});

test("SA-059 U03v: CostGuard exception expiry and malformed configuration block follow-up available-slot delete",async()=>{
  const scenarios=[{"initial":"read_only","column":"cost_guard_exception_until","reason":"maintenance_mode"},{"initial":"normal","column":"disabled_features_json","reason":"cost_guard_blocked"},{"initial":"normal","column":"cost_guard_exception_features_json","reason":"cost_guard_blocked"}];
  for(const scenario of scenarios){
    const s=setup({mode:scenario.initial});
    try{
      const now=Math.floor(Date.now()/1000);
      if(scenario.initial==="read_only"){
        s.sqlite.prepare("UPDATE system_settings SET cost_guard_exception_until=?, cost_guard_exception_features_json=? WHERE id='default'")
          .run(now+600,JSON.stringify(["manage_slot_delete"]));
      }
      const first=await s.post();
      assert.equal(first.status,200,scenario.column+" first "+await first.clone().text());
      assert.deepEqual(s.idsLeft(),["d","e","f"]);
      assert.equal(s.stats.batches,1);
      const invalidValue=scenario.column==="cost_guard_exception_until"?now-1:"{invalid-json";
      s.sqlite.prepare("UPDATE system_settings SET "+scenario.column+"=? WHERE id='default'").run(invalidValue);
      const denied=await s.post();
      assert.equal(denied.status,503,scenario.column+" "+await denied.clone().text());
      assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
      assert.equal((await denied.json()).reason,scenario.reason);
      assert.deepEqual(s.idsLeft(),["d","e","f"]);
      assert.equal(s.count("audit_logs"),3);
      assert.equal(s.count("static_rebuild_queue"),3);
      assert.equal(s.stats.batches,1,"denied next request must never mutate");
    }finally{s.sqlite.close();}
  }
});

test("SA-059 U03n: authority, tenant and CostGuard fail before any write",async()=>{
  for(const opts of [
    {actor:VIEWER,status:404},
    {actor:null,status:401},
    {actor:ADMIN,mode:"maintenance",status:503},
  ]){
    const s=setup(opts);
    try{
      const res=await s.post();
      assert.equal(res.status,opts.status,await res.clone().text());
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,0);
    }finally{s.sqlite.close();}
  }
  const allowed=setup({actor:VIEWER,staff:true});
  try{
    const ok=await allowed.post();
    assert.equal(ok.status,200,await ok.clone().text());
    assert.equal(allowed.count("audit_logs"),3);
  }finally{allowed.sqlite.close();}
  const foreign=setup();
  try{
    const missing=await foreign.post("ev-2");
    assert.equal(missing.status,404);
    assert.equal(foreign.count("audit_logs"),0);
    assert.deepEqual(foreign.idsLeft(),["a","b","c","d","e","f"]);
  }finally{foreign.sqlite.close();}
});

test("SA-059 U03q: revoking staff or X approval between chunks stops continuation",async()=>{
  const s=setup({actor:VIEWER,staff:true});
  try{
    const first=await s.post();
    assert.equal(first.status,200,await first.clone().text());
    assert.deepEqual(s.idsLeft(),["d","e","f"]);
    assert.equal(s.count("audit_logs"),3);
    assert.equal(s.stats.batches,1);
    s.sqlite.prepare("UPDATE event_staff SET permission_preset='reviewer' WHERE event_id='ev-1'").run();
    const denied=await s.post();
    assert.equal(denied.status,404,await denied.clone().text());
    assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
    assert.deepEqual(s.idsLeft(),["d","e","f"]);
    assert.equal(s.count("audit_logs"),3);
    assert.equal(s.stats.batches,1);
    s.sqlite.prepare("UPDATE event_staff SET permission_preset='slot_manager' WHERE event_id='ev-1'").run();
    s.sqlite.prepare("UPDATE x_users SET approval_status='pending' WHERE id='x1'").run();
    const unapproved=await s.post();
    assert.equal(unapproved.status,404,await unapproved.clone().text());
    assert.deepEqual(s.idsLeft(),["d","e","f"]);
    assert.equal(s.count("audit_logs"),3);
    assert.equal(s.stats.batches,1);
    s.sqlite.prepare("UPDATE x_users SET approval_status='approved' WHERE id='x1'").run();
    const continued=await s.post();
    assert.equal(continued.status,200,await continued.clone().text());
    assert.deepEqual(s.idsLeft(),[]);
    assert.equal(s.count("audit_logs"),6);
    assert.equal(s.stats.batches,2);
  }finally{s.sqlite.close();}
});

test("SA-059 U03t: new major terms and revoked consent/mirror after snapshot block DELETE",async()=>{
  for(const mode of ["new-major","consent-revoked","accepted-mirror-cleared","new-major-supersedes"]){
    let changed=false;
    const s=setup({onFirst:(sql,sqlite)=>{
      if(changed||!sql.includes("AS rows_json"))return;
      changed=true;
      if(mode==="consent-revoked"){
        sqlite.prepare("DELETE FROM user_tos_consents WHERE user_id=?").run(ADMIN.id);
      }else if(mode==="accepted-mirror-cleared"){
        sqlite.prepare('UPDATE "user" SET accepted_terms_version_id=NULL WHERE id=?').run(ADMIN.id);
      }else if(mode==="new-major-supersedes"){
        sqlite.prepare("INSERT INTO terms_versions VALUES (?,?,?,?)").run("terms-v2","major",200,200);
      }else{
        sqlite.prepare("INSERT INTO terms_versions VALUES (?,?,?,?)").run("terms-v1","major",100,100);
      }
    }});
    try{
      if(mode!=="new-major"){
        s.sqlite.prepare("INSERT INTO terms_versions VALUES (?,?,?,?)").run("terms-v1","major",100,100);
      }
      if(mode==="consent-revoked"){
        s.sqlite.prepare("INSERT INTO user_tos_consents VALUES (?,?,?)")
          .run("consent-v1",ADMIN.id,"terms-v1");
      }else if(mode!=="new-major"){
        s.sqlite.prepare('UPDATE "user" SET accepted_terms_version_id=? WHERE id=?')
          .run("terms-v1",ADMIN.id);
      }
      const res=await s.post();
      assert.equal(changed,true,mode+" injection reached");
      assert.equal(res.status,409,mode+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1);
    }finally{s.sqlite.close();}
  }
  const valid=setup();
  try{
    valid.sqlite.prepare("INSERT INTO terms_versions VALUES (?,?,?,?)")
      .run("terms-v1","major",100,100);
    valid.sqlite.prepare('UPDATE "user" SET accepted_terms_version_id=? WHERE id=?')
      .run("terms-v1",ADMIN.id);
    const ok=await valid.post();
    assert.equal(ok.status,200,await ok.clone().text());
    assert.deepEqual(valid.idsLeft(),["d","e","f"]);
    assert.equal(valid.count("audit_logs"),3);
  }finally{valid.sqlite.close();}
});

test("SA-059 U03s: admin demotion, user ban or TOS reversal after snapshot rejects DELETE",async()=>{
  for(const mode of ["admin-demoted","admin-banned","admin-tos-revoked","staff-banned"]){
    let changed=false;
    const isStaff=mode==="staff-banned";
    const actor=isStaff?VIEWER:ADMIN;
    const s=setup({actor,staff:isStaff,onFirst:(sql,sqlite)=>{
      if(changed||!sql.includes("AS rows_json"))return;
      changed=true;
      const id=actor.id;
      if(mode==="admin-demoted"){
        sqlite.prepare('UPDATE "user" SET role=? WHERE id=?').run("user",id);
      }else if(mode==="admin-tos-revoked"){
        sqlite.prepare('UPDATE "user" SET is_tos_accepted=0 WHERE id=?').run(id);
      }else{
        sqlite.prepare('UPDATE "user" SET is_banned=1 WHERE id=?').run(id);
      }
    }});
    try{
      const res=await s.post();
      assert.equal(changed,true,mode+" race not injected");
      assert.equal(res.status,409,mode+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1,"recheck fails inside same D1 batch");
    }finally{s.sqlite.close();}
  }
});

test("SA-059 U03z: expiring exception after middleware read denies before scoped write",async()=>{
  for(const mode of ["read_only","disabled_feature"]){
    let expired=false;
    const feature="manage_slot_delete";
    const s=setup({mode:mode==="read_only"?"read_only":"normal",onFirst:(sql,sqlite)=>{
      // The initial middleware CostGuard already received its ALLOW row.
      // Expire the same exception BEFORE the event/staff/slots scope read.
      if(expired || !sql.includes("FROM system_settings WHERE id"))return;
      expired=true;
      sqlite.prepare("UPDATE system_settings SET cost_guard_exception_until=? WHERE id='default'")
        .run(Math.floor(Date.now()/1000)-1);
    }});
    try{
      const now=Math.floor(Date.now()/1000);
      s.sqlite.prepare(
        "UPDATE system_settings SET cost_guard_exception_until=?,"+
        "cost_guard_exception_features_json=?,disabled_features_json=? WHERE id='default'"
      ).run(now+600,JSON.stringify([feature]),
        mode==="disabled_feature"?JSON.stringify([feature]):null);
      const denied=await s.post();
      assert.equal(expired,true,"the middleware->scope expiry hook must execute");
      assert.equal(denied.status,503,mode+" "+await denied.clone().text());
      assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
      assert.equal((await denied.json()).reason,
        mode==="read_only"?"maintenance_mode":"cost_guard_blocked");
      assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,0,"deny before any D1 mutation batch");
      assert.equal(s.stats.reads,2,"middleware CostGuard and scope SELECT only");
    }finally{s.sqlite.close();}
  }
});

test("SA-059 U03x: CostGuard revocation after middleware SELECT but before scoped SELECT denies without a D1 batch",async()=>{
  const scenarios=[
    {kind:"read-only",reason:"maintenance_mode"},
    {kind:"disabled",reason:"cost_guard_blocked"},
    {kind:"missing-settings",reason:"cost_guard_blocked"},
  ];
  for(const scenario of scenarios){
    let flipped=false;
    const s=setup({onFirst:(query,sqlite)=>{
      // The FIRST CostGuard SELECT returns the previously approved policy;
      // mutate immediately after that result, before the event/slot scope read.
      if(flipped || !query.includes("FROM system_settings WHERE id")) return;
      flipped=true;
      if(scenario.kind==="read-only"){
        sqlite.prepare("UPDATE system_settings SET operation_mode='read_only' WHERE id='default'").run();
      }else if(scenario.kind==="disabled"){
        sqlite.prepare("UPDATE system_settings SET disabled_features_json=? WHERE id='default'")
          .run(JSON.stringify(["manage_slot_delete"]));
      }else{
        sqlite.prepare("DELETE FROM system_settings WHERE id='default'").run();
      }
    }});
    try{
      const denied=await s.post();
      assert.equal(flipped,true,scenario.kind+" transition was injected");
      assert.equal(denied.status,503,scenario.kind+" "+await denied.clone().text());
      assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
      assert.equal((await denied.json()).reason,scenario.reason);
      assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,0,"scope gate must deny before constructing atomic D1 batch");
      assert.equal(s.stats.reads,2,"existing parent CostGuard + scoped read only");
    }finally{s.sqlite.close();}
  }
});

test("SA-059 U03w: CostGuard change after snapshot SELECT rolls back DELETE, audits and queue",async()=>{
  for(const kind of ["read-only","disabled-feature","deleted-settings","expired-exception"]){
    let changed=false;
    const s=setup({mode:kind==="expired-exception"?"read_only":"normal",onFirst:(query,sqlite)=>{
      if(changed||!query.includes("AS rows_json"))return;
      changed=true;
      if(kind==="read-only") sqlite.prepare("UPDATE system_settings SET operation_mode='read_only' WHERE id='default'").run();
      if(kind==="disabled-feature") sqlite.prepare("UPDATE system_settings SET disabled_features_json=? WHERE id='default'").run(JSON.stringify(["manage_slot_delete"]));
      if(kind==="deleted-settings") sqlite.prepare("DELETE FROM system_settings WHERE id='default'").run();
      if(kind==="expired-exception") sqlite.prepare("UPDATE system_settings SET cost_guard_exception_until=? WHERE id='default'").run(Math.floor(Date.now()/1000)-1);
    }});
    try{
      if(kind==="expired-exception") s.sqlite.prepare("UPDATE system_settings SET cost_guard_exception_until=?,cost_guard_exception_features_json=? WHERE id='default'").run(Math.floor(Date.now()/1000)+600,JSON.stringify(["manage_slot_delete"]));
      const res=await s.post();
      assert.equal(changed,true,kind);
      assert.equal(res.status,409,kind+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1);
      assert.ok(s.stats.reads<=2,"no additional preread");
    }finally{s.sqlite.close();}
  }
});

test("SA-059 U03r: permission, linked-X approval or event removed AFTER snapshot blocks DELETE",async()=>{
  for(const revoked of ["permission","x-approval","event-deleted"]){
    let injected=false;
    const s=setup({actor:VIEWER,staff:true,onFirst:(query,sqlite)=>{
      if(injected||!query.includes("AS rows_json"))return;
      injected=true;
      if(revoked==="permission"){
        sqlite.prepare("UPDATE event_staff SET permission_preset='reviewer' WHERE event_id='ev-1'").run();
      }else if(revoked==="x-approval"){
        sqlite.prepare("UPDATE x_users SET approval_status='pending' WHERE id='x1'").run();
      }else{
        sqlite.prepare("DELETE FROM events WHERE id='ev-1'").run();
      }
    }});
    try{
      const res=await s.post();
      assert.equal(injected,true,revoked+" read-time race injected");
      assert.equal(res.status,409,revoked+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
      assert.equal(s.count("audit_logs"),0);
      assert.equal(s.count("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1,"scope rejection occurs inside D1 batch");
    }finally{s.sqlite.close();}
  }
});

test("SA-059 U03n: concurrent reservation with unchanged version aborts entire batch",async()=>{
  let injected=false;
  const s=setup({onFirst:(sql,sqlite)=>{
    if(!injected&&sql.includes("AS rows_json")){
      injected=true;
      sqlite.prepare("UPDATE slots SET status='reserved' WHERE id='b'").run();
    }
  }});
  try{
    const res=await s.post();
    assert.equal(injected,true);
    assert.equal(res.status,409,await res.clone().text());
    assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
    assert.equal(s.slot("b").status,"reserved");
    assert.equal(s.count("audit_logs"),0);
    assert.equal(s.count("static_rebuild_queue"),0);
    assert.equal(s.stats.batches,1);
  }finally{s.sqlite.close();}
});

test("SA-059 U03n: strict audit table failure rolls back slot deletion and rebuild intents",async()=>{
  const s=setup();
  try{
    s.sqlite.exec("DROP TABLE audit_logs");
    const res=await s.post();
    assert.equal(res.status,503,await res.clone().text());
    assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
    assert.equal(s.count("static_rebuild_queue"),0);
    assert.equal(s.stats.batches,1);
  }finally{s.sqlite.close();}
});

test("SA-059 U03o: static rebuild queue write failure rolls back DELETE and audits",async()=>{
  const s=setup();
  try{
    // buildSlotChangeQueueBatch plans SQL in memory; the table is required
    // only when mutateWithAudit executes DELETE + Queue + audit together.
    s.sqlite.exec("DROP TABLE static_rebuild_queue");
    const res=await s.post();
    assert.equal(res.status,503,await res.clone().text());
    assert.equal(res.headers.get("Cache-Control"),"private, no-store");
    assert.deepEqual(s.idsLeft(),["a","b","c","d","e","f"]);
    assert.equal(s.count("audit_logs"),0);
    assert.equal(s.stats.batches,1,"failed Queue INSERT must abort one D1 batch");
  }finally{s.sqlite.close();}
});

test("SA-059 U03o: mixed reserved/submitted slots are never deleted",async()=>{
  const s=setup({ids:["a","b"]});
  try{
    s.add(row("reserved","reserved"));
    s.add(row("submitted","submitted"));
    const res=await s.post();
    assert.equal(res.status,200,await res.clone().text());
    assert.deepEqual(await res.json(),{
      ok:true,deletedThisChunk:2,moreAtSnapshot:false,
      completionVerified:false,pendingPublicReflection:true,
    });
    assert.deepEqual(s.idsLeft(),["reserved","submitted"]);
    assert.equal(s.slot("reserved").status,"reserved");
    assert.equal(s.slot("submitted").status,"submitted");
    assert.equal(s.count("audit_logs"),2);
    assert.equal(s.count("static_rebuild_queue"),3);
    assert.equal(s.stats.batches,1);
    const again=await s.post();
    assert.equal(again.status,409,await again.clone().text());
    assert.deepEqual(s.idsLeft(),["reserved","submitted"]);
    assert.equal(s.stats.batches,1);
  }finally{s.sqlite.close();}
});

test("SA-059 U03n: read-time 3-row sentinel is not a completion proof under concurrent insert",async()=>{
  let added=false;
  const s=setup({ids:["a"],onFirst:(sql,sqlite)=>{
    if(!added&&sql.includes("AS rows_json")){
      added=true;
      sqlite.prepare("INSERT INTO slots VALUES("+columns.map(()=>"?").join(",")+")")
        .run(...columns.map(k=>row("b")[k]));
    }
  }});
  try{
    const res=await s.post();
    assert.equal(res.status,200,await res.clone().text());
    assert.deepEqual(await res.json(),{
      ok:true,deletedThisChunk:1,moreAtSnapshot:false,
      completionVerified:false,pendingPublicReflection:true,
    });
    assert.deepEqual(s.idsLeft(),["b"],"a concurrently arrived slot remains");
    assert.equal(s.count("audit_logs"),1);
  }finally{s.sqlite.close();}
});

test("SA-059 U03n: candidate route stays UNMOUNTED in production parent",()=>{
  const index=readFileSync(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotAvailableDeleteChunkRoutes|slotAvailableDeleteChunk\.ts/);
});

// MIG-0656 U03p: SA-058 one-chunk Hono + SQLite D1 parity, TEST-ONLY mounted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { slotGeneratedChunkRoutes } from "../src/routes/manage/slotGeneratedChunk.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ORIGIN="https://app.flamenode.example";
const ADMIN={id:"admin-1",role:"admin",is_banned:0};
const VIEWER={id:"viewer",role:"user",is_banned:0};
const keys=["id","event_id","reserved_by_user_id","x_user_id","reserved_x_id_snapshot",
  "display_name","slot_label","start_time","sort_order","reservation_group_id","video_id",
  "status","updated_at","version"];
const countInput=(count=3,start=1)=>({mode:"count",count,start_index:start});
function setup({actor=ADMIN,staff=false,mode="normal",onFirst}={}){
  const {db,sqlite,stats}=createAdminD1({onFirst});
  seedBase(sqlite,{settings:mode});
  seedEvent(sqlite);
  sqlite.exec([
    "CREATE TABLE event_staff(event_id TEXT,x_user_id TEXT,permission_preset TEXT,custom_permission_keys_json TEXT);",
    "CREATE TABLE slots("+keys.map(k=>k==="id"?"id TEXT PRIMARY KEY":
      ["start_time","sort_order","updated_at","version"].includes(k)?
      k+" INTEGER":k+" TEXT").join(",")+");",
  ].join(" "));
  if(actor&&actor.id!==ADMIN.id){
    sqlite.prepare('INSERT INTO "user"(id,name,role,is_banned,is_tos_accepted) VALUES (?,?,?,0,1)')
      .run(actor.id,"Viewer",actor.role);
  }
  if(staff&&actor){
    sqlite.prepare("INSERT INTO x_users(id,approval_status) VALUES (?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)").run(actor.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)")
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
  app.route("/api/manage/events/:id/slots",slotGeneratedChunkRoutes);
  const post=(body=countInput(),event="ev-1")=>app.request(
    ORIGIN+"/api/manage/events/"+event+"/slots/generate-chunk",
    {method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/json"},
      body:JSON.stringify(body)},
    {DB:db,NEXT_PUBLIC_SITE_URL:ORIGIN},
  );
  const slots=()=>sqlite.prepare("SELECT * FROM slots ORDER BY sort_order,id").all();
  const rowById=(id)=>sqlite.prepare("SELECT * FROM slots WHERE id=?").get(id);
  const n=(table)=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
  const add=(slot)=>sqlite.prepare("INSERT INTO slots VALUES ("+keys.map(()=>"?").join(",")+")")
    .run(...keys.map(k=>slot[k]));
  return {sqlite,stats,post,slots,rowById,n,add};
}
test("SA-058 U03p: bounded 3-slot count generation is audited and queued atomically",async()=>{
  const s=setup();
  try{
    const res=await s.post();
    assert.equal(res.status,200,await res.clone().text());
    assert.equal(res.headers.get("Cache-Control"),"private, no-store");
    assert.deepEqual(await res.json(),{
      ok:true,createdThisChunk:3,completionVerified:false,pendingPublicReflection:true,
    });
    assert.equal(s.stats.batches,1);
    assert.ok(s.stats.reads<=2);
    assert.equal(s.n("slots"),3);
    assert.equal(s.n("audit_logs"),3);
    assert.equal(s.n("static_rebuild_queue"),3);
    assert.deepEqual(s.slots().map(r=>r.sort_order),[1,2,3]);
    assert.deepEqual(s.slots().map(r=>r.slot_label),["No.1","No.2","No.3"]);
    for(const slot of s.slots()){
      assert.equal(slot.status,"available");
      assert.equal(slot.version,1);
      assert.equal(slot.reserved_by_user_id,null);
      assert.equal(slot.reserved_x_id_snapshot,null);
      assert.ok(/^slot_/.test(slot.id));
    }
    for(const audit of s.sqlite.prepare("SELECT * FROM audit_logs").all()){
      assert.equal(audit.operation,"CREATE");
      assert.equal(audit.retention_class,"normal");
      assert.equal(JSON.parse(audit.after_json).id,audit.target_id);
    }
    assert.ok(s.sqlite.prepare("SELECT reason FROM static_rebuild_queue").all()
      .every(row=>row.reason==="slot_admin_generate"));
  }finally{s.sqlite.close();}
});
test("SA-058 U03u: CostGuard changes between chunks block the next generated write",async()=>{
  for(const block of [
    {column:"operation_mode",value:"read_only",reason:"maintenance_mode"},
    {column:"disabled_features_json",value:'["manage_slot_create"]',reason:"cost_guard_blocked"},
  ]){
    const s=setup();
    try{
      const first=await s.post(countInput(3,1));
      assert.equal(first.status,200,await first.clone().text());
      assert.equal(s.stats.batches,1);
      s.sqlite.prepare("UPDATE system_settings SET "+block.column+"=? WHERE id='default'").run(block.value);
      const denied=await s.post(countInput(3,4));
      assert.equal(denied.status,503,await denied.clone().text());
      assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
      assert.equal((await denied.json()).reason,block.reason);
      assert.deepEqual(s.slots().map(r=>r.sort_order),[1,2,3]);
      assert.equal(s.n("audit_logs"),3);
      assert.equal(s.n("static_rebuild_queue"),3);
      assert.equal(s.stats.batches,1,"second request must not attempt D1 mutation");
    }finally{s.sqlite.close();}
  }
});

test("SA-058 U03v: CostGuard exception expiry and malformed configuration block follow-up generated slot",async()=>{
  const scenarios=[{"initial":"read_only","column":"cost_guard_exception_until","reason":"maintenance_mode"},{"initial":"normal","column":"disabled_features_json","reason":"cost_guard_blocked"},{"initial":"normal","column":"cost_guard_exception_features_json","reason":"cost_guard_blocked"}];
  for(const scenario of scenarios){
    const s=setup({mode:scenario.initial});
    try{
      const now=Math.floor(Date.now()/1000);
      if(scenario.initial==="read_only"){
        s.sqlite.prepare("UPDATE system_settings SET cost_guard_exception_until=?, cost_guard_exception_features_json=? WHERE id='default'")
          .run(now+600,JSON.stringify(["manage_slot_create"]));
      }
      const first=await s.post(countInput(3,1));
      assert.equal(first.status,200,scenario.column+" first "+await first.clone().text());
      assert.deepEqual(s.slots().map(x=>x.sort_order),[1,2,3]);
      assert.equal(s.stats.batches,1);
      const invalidValue=scenario.column==="cost_guard_exception_until"?now-1:"{invalid-json";
      s.sqlite.prepare("UPDATE system_settings SET "+scenario.column+"=? WHERE id='default'").run(invalidValue);
      const denied=await s.post(countInput(3,4));
      assert.equal(denied.status,503,scenario.column+" "+await denied.clone().text());
      assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
      assert.equal((await denied.json()).reason,scenario.reason);
      assert.deepEqual(s.slots().map(x=>x.sort_order),[1,2,3]);
      assert.equal(s.n("audit_logs"),3);
      assert.equal(s.n("static_rebuild_queue"),3);
      assert.equal(s.stats.batches,1,"denied next request must never mutate");
    }finally{s.sqlite.close();}
  }
});

test("SA-058 U03p: time mode 2-slot insert and repeated count chunk fail closed",async()=>{
  const s=setup();
  try{
    const time={mode:"time",start_at:"2026-11-08T09:00",end_at:"2026-11-08T09:10",interval_minutes:5};
    const done=await s.post(time);
    assert.equal(done.status,200,await done.clone().text());
    assert.deepEqual(await done.json(),{
      ok:true,createdThisChunk:2,completionVerified:false,pendingPublicReflection:true,
    });
    assert.equal(s.n("slots"),2);
    assert.equal(s.slots()[1].start_time-s.slots()[0].start_time,300);
    assert.equal(s.slots()[0].slot_label,null);
    const again=await s.post(time);
    assert.equal(again.status,409,await again.clone().text());
    assert.equal(s.n("slots"),2);
    assert.equal(s.n("audit_logs"),2);
    assert.equal(s.stats.batches,2,"retry can attempt a batch but cannot commit");
    // A separate non-overlapping chunk is allowed, not a resume-token claim.
    const count=await s.post(countInput(2,10));
    assert.equal(count.status,200,await count.clone().text());
    assert.equal(s.n("slots"),4);
    assert.equal(s.n("audit_logs"),4);
  }finally{s.sqlite.close();}
});
test("SA-058 U03p: count replay with fresh IDs and pre-read concurrent collision",async()=>{
  let injected=false;
  const s=setup({onFirst:(sql,sqlite)=>{
    if(!injected && sql.includes("AS staff_json")){
      injected=true;
      sqlite.prepare("INSERT INTO slots VALUES ("+keys.map(()=>"?").join(",")+")")
        .run("external","ev-1",null,null,null,null,"other",null,1,null,null,"reserved",10,1);
    }
  }});
  try{
    const res=await s.post(countInput(3,1));
    assert.equal(injected,true);
    assert.equal(res.status,409,await res.clone().text());
    assert.equal(s.n("slots"),1);
    assert.equal(s.slots()[0].status,"reserved");
    assert.equal(s.n("audit_logs"),0);
    assert.equal(s.n("static_rebuild_queue"),0);
    assert.equal(s.stats.batches,1);
  }finally{s.sqlite.close();}
});
test("SA-058 U03p: invalid inputs, >3 and tenant/status checks have no write effects",async()=>{
  const s=setup();
  try{
    for(const [body,event,status] of [
      [{mode:"count",count:4},"ev-1",409],
      [{mode:"count",count:0},"ev-1",400],
      [{mode:"count",count:"3"},"ev-1",400],
      [countInput(3),"bad id",400],
      [countInput(3),"other",404],
    ]){
      const r=await s.post(body,event);
      assert.equal(r.status,status,await r.clone().text());
    }
    assert.equal(s.n("slots"),0);
    assert.equal(s.n("audit_logs"),0);
    assert.equal(s.n("static_rebuild_queue"),0);
    assert.equal(s.stats.batches,0);
  }finally{s.sqlite.close();}
});
test("SA-058 U03p: anonymous/unauthorized/maintenance actors cannot generate",async()=>{
  for(const opts of [
    {actor:null,want:401},{actor:VIEWER,want:404},
    {actor:ADMIN,mode:"maintenance",want:503},
  ]){
    const s=setup(opts);
    try{
      const r=await s.post();
      assert.equal(r.status,opts.want,await r.clone().text());
      assert.equal(s.n("slots"),0);
      assert.equal(s.n("audit_logs"),0);
      assert.equal(s.stats.batches,0);
    }finally{s.sqlite.close();}
  }
  const s=setup({actor:VIEWER,staff:true});
  try{
    assert.equal((await s.post()).status,200);
    assert.equal(s.n("slots"),3);
  }finally{s.sqlite.close();}
});
test("SA-058 U03q: staff privilege and approved-X revocation between chunks fails closed",async()=>{
  const s=setup({actor:VIEWER,staff:true});
  try{
    const first=await s.post(countInput(2,1));
    assert.equal(first.status,200,await first.clone().text());
    assert.equal(s.n("slots"),2);
    assert.equal(s.n("audit_logs"),2);
    assert.equal(s.stats.batches,1);
    // Staff preset can change independently of the active auth session.
    s.sqlite.prepare("UPDATE event_staff SET permission_preset='reviewer' WHERE event_id='ev-1'").run();
    const denied=await s.post(countInput(2,3));
    assert.equal(denied.status,404,await denied.clone().text());
    assert.equal(denied.headers.get("Cache-Control"),"private, no-store");
    assert.equal(s.stats.batches,1);
    assert.equal(s.n("slots"),2);
    assert.equal(s.n("audit_logs"),2);
    // Reinstating the preset must not bypass approved X account linkage.
    s.sqlite.prepare("UPDATE event_staff SET permission_preset='slot_manager' WHERE event_id='ev-1'").run();
    s.sqlite.prepare("UPDATE x_users SET approval_status='pending' WHERE id='x1'").run();
    const unapproved=await s.post(countInput(2,3));
    assert.equal(unapproved.status,404,await unapproved.clone().text());
    assert.equal(s.stats.batches,1);
    assert.equal(s.n("slots"),2);
    assert.equal(s.n("audit_logs"),2);
    // This is a fresh authorized request, NOT idempotent resume of the first.
    s.sqlite.prepare("UPDATE x_users SET approval_status='approved' WHERE id='x1'").run();
    const next=await s.post(countInput(2,3));
    assert.equal(next.status,200,await next.clone().text());
    assert.equal(s.n("slots"),4);
    assert.equal(s.n("audit_logs"),4);
    assert.equal(s.stats.batches,2);
  }finally{s.sqlite.close();}
});

test("SA-058 U03t: new published major terms or revoked acceptance after pre-read blocks INSERT",async()=>{
  for(const mode of ["new-major","consent-revoked","accepted-mirror-cleared","new-major-supersedes"]){
    let changed=false;
    const s=setup({onFirst:(sql,sqlite)=>{
      if(changed||!sql.includes("AS staff_json"))return;
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
      const res=await s.post(countInput(3,1));
      assert.equal(changed,true,mode+" injection reached");
      assert.equal(res.status,409,mode+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.equal(s.n("slots"),0);
      assert.equal(s.n("audit_logs"),0);
      assert.equal(s.n("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1);
    }finally{s.sqlite.close();}
  }
  const valid=setup();
  try{
    valid.sqlite.prepare("INSERT INTO terms_versions VALUES (?,?,?,?)")
      .run("terms-v1","major",100,100);
    valid.sqlite.prepare("INSERT INTO user_tos_consents VALUES (?,?,?)")
      .run("consent-v1",ADMIN.id,"terms-v1");
    const ok=await valid.post(countInput(1,1));
    assert.equal(ok.status,200,await ok.clone().text());
    assert.equal(valid.n("slots"),1);
    assert.equal(valid.n("audit_logs"),1);
  }finally{valid.sqlite.close();}
});

test("SA-058 U03s: admin role downgrade, account ban or TOS reversal after scope read rejects INSERT",async()=>{
  for(const mode of ["admin-demoted","admin-banned","admin-tos-revoked","staff-banned"]){
    let changed=false;
    const isStaff=mode==="staff-banned";
    const actor=isStaff?VIEWER:ADMIN;
    const s=setup({actor,staff:isStaff,onFirst:(sql,sqlite)=>{
      if(changed||!sql.includes("AS staff_json"))return;
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
      const res=await s.post(countInput(3,1));
      assert.equal(changed,true,mode+" race not injected");
      assert.equal(res.status,409,mode+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.equal(s.n("slots"),0);
      assert.equal(s.n("audit_logs"),0);
      assert.equal(s.n("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1,"recheck fails inside same D1 batch");
    }finally{s.sqlite.close();}
  }
});

test("SA-058 U03r: staff approval or permission revoked AFTER pre-read aborts atomic INSERT",async()=>{
  for(const revoked of ["permission","x-approval","event-deleted"]){
    let injected=false;
    const s=setup({actor:VIEWER,staff:true,onFirst:(query,sqlite)=>{
      if(injected||!query.includes("AS staff_json"))return;
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
      const res=await s.post(countInput(3,1));
      assert.equal(injected,true,revoked+" read-time race injected");
      assert.equal(res.status,409,revoked+" "+await res.clone().text());
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
      assert.equal(s.n("slots"),0);
      assert.equal(s.n("audit_logs"),0);
      assert.equal(s.n("static_rebuild_queue"),0);
      assert.equal(s.stats.batches,1,"scope rejection occurs inside D1 batch");
    }finally{s.sqlite.close();}
  }
});

test("SA-058 U03p: strict audit and Queue failures each roll back all new rows",async()=>{
  for(const table of ["audit_logs","static_rebuild_queue"]){
    const s=setup();
    try{
      s.sqlite.exec("DROP TABLE "+table);
      const r=await s.post();
      assert.equal(r.status,503,await r.clone().text());
      assert.equal(s.n("slots"),0,table);
      assert.equal(s.n(table==="audit_logs"?"static_rebuild_queue":"audit_logs"),0);
      assert.equal(s.stats.batches,1);
    }finally{s.sqlite.close();}
  }
});
test("SA-058 U03p: all generated writes remain UNMOUNTED on the production parent",()=>{
  const index=readFileSync(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotGeneratedChunkRoutes|slotGeneratedChunk\.ts/);
});

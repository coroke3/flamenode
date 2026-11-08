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

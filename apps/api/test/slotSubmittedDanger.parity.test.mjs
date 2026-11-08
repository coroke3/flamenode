// MIG-0656 U03f: real Hono candidate + SQLite D1 batch, still UNMOUNTED.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { slotSubmittedDangerRoutes } from "../src/routes/manage/slotSubmittedDanger.ts";
import { SUBMITTED_VIDEO_AUDIT_COLUMNS } from "../src/routes/manage/slotSubmittedVideoAudit.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ORIGIN="https://app.flamenode.example";
const ADMIN={id:"admin-1",role:"admin",is_banned:0};
const STAFF={id:"staff-1",role:"user",is_banned:0};
const cols=[
  "id","event_id","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","slot_label","start_time",
  "sort_order","reservation_group_id","video_id","status","updated_at","version",
];
const slot=(id,patch={})=>({
  id,event_id:"ev-1",reserved_by_user_id:"recipient-1",
  x_user_id:"x1",reserved_x_id_snapshot:"x1",display_name:"Owner",
  slot_label:"Keep",start_time:null,sort_order:0,
  reservation_group_id:"g  ",video_id:"vid",
  status:"submitted",updated_at:100,version:1,...patch,
});
const video=(patch={})=>({
  id:"vid",primary_event_id:"ev-1",creator_x_user_id:"x1",
  submitted_by_user_id:"recipient-1",collaboration_type:"individual",
  part:null,source_type:"manual",creator_display_name:"Creator",
  creator_display_name_yomi:null,creator_icon_url:null,
  creator_youtube_channel_url:null,creator_profile_text:"Review complete 30 fields",
  creator_other_social_links:null,title:"Video title",music:null,
  credit:null,music_reference_url:null,closing_comment:null,
  youtube_video_id:null,intro_comment:null,highlights:null,
  production_story:null,visibility_status:"pending",
  scheduling_type:"slotted",scheduled_time:null,
  app_like_count:5,score:2.5,score_updated_at:null,
  created_at:50,updated_at:400,...patch,
});
function setup({kind="force-release",count=2,actor=ADMIN,staff=false,
  mode="normal",onFirst,mutate,seedVideo=true}={}){
  const {db,sqlite,stats}=createAdminD1({onFirst});
  seedBase(sqlite,{settings:mode});
  seedEvent(sqlite);
  sqlite.exec([
    'ALTER TABLE "user" ADD COLUMN is_notification_enabled INTEGER DEFAULT 1;',
    'INSERT INTO "user" (id,name,role,is_banned,is_tos_accepted,is_notification_enabled)',
    "VALUES ('recipient-1','Recipient','user',0,1,1);",
    "CREATE TABLE event_staff (event_id TEXT,x_user_id TEXT,permission_preset TEXT,",
    "custom_permission_keys_json TEXT);",
    "CREATE TABLE videos(" + SUBMITTED_VIDEO_AUDIT_COLUMNS.map(k=>
      k==="id" ? "id TEXT PRIMARY KEY" :
      ["scheduled_time","app_like_count","score_updated_at","created_at","updated_at"]
        .includes(k) ? k+" INTEGER" : k==="score" ? "score REAL" : k+" TEXT"
    ).join(",") + ");",
    "CREATE TABLE slots(" + cols.map(k=>k==="id" ? "id TEXT PRIMARY KEY" :
      ["start_time","sort_order","updated_at","version"].includes(k)
        ? k+" INTEGER" : k+" TEXT").join(",") + ");",
    "CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,recipient_user_id TEXT,",
    "type TEXT,payload_json TEXT,delivery_route TEXT,correlation_id TEXT,",
    "status TEXT,attempt_count INTEGER,processing_started_at INTEGER,",
    "lease_token TEXT,lease_expires_at INTEGER,next_attempt_at INTEGER,",
    "last_error TEXT,processed_at INTEGER,event_id TEXT,dedupe_key TEXT,created_at INTEGER);",
    "CREATE UNIQUE INDEX active_dedupe ON notification_outbox(dedupe_key)",
    "WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','sent');",
  ].join(" "));
  const insertVideo=sqlite.prepare("INSERT INTO videos VALUES(" +
    SUBMITTED_VIDEO_AUDIT_COLUMNS.map(()=>"?").join(",") + ")");
  if(seedVideo)insertVideo.run(...SUBMITTED_VIDEO_AUDIT_COLUMNS.map(k=>video()[k]));
  const insert=sqlite.prepare("INSERT INTO slots VALUES(" + cols.map(()=>"?").join(",") + ")");
  const write=row=>insert.run(...cols.map(k=>row[k]));
  for(let i=0;i<count;i++)write(slot("s"+i,{sort_order:i}));
  if(actor && actor.id!==ADMIN.id){
    sqlite.prepare('INSERT INTO "user"(id,name,role,is_banned,is_tos_accepted) VALUES (?,?,?,0,1)')
      .run(actor.id,"Staff",actor.role);
  }
  if(staff && actor){
    sqlite.prepare("INSERT INTO x_users(id,approval_status) VALUES (?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)").run(actor.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)")
      .run("ev-1","x1","slot_manager",null);
  }
  mutate?.({sqlite,write,insertVideo});
  const app=new Hono();
  app.use("*",async(c,next)=>{
    c.set("user",actor);
    c.set("db",drizzle(c.env.DB,{schema}));
    if(actor)c.set("actorSnapshotJsonById",{
      [actor.id]:JSON.stringify({id:actor.id,role:actor.role}),
    });
    await next();
  });
  // Intentional TEST-ONLY mount: manage/index.ts remains untouched.
  app.route("/api/manage/events/:id/slots",slotSubmittedDangerRoutes);
  const post=(slotId="s0",eventId="ev-1",op=kind)=>app.request(
    ORIGIN+"/api/manage/events/"+eventId+"/slots/"+slotId+"/"+
      (op==="force-release"?"force-release-submitted":"release-submitted-video"),
    {method:"POST",headers:{Origin:ORIGIN}},
    {DB:db,NEXT_PUBLIC_SITE_URL:ORIGIN},
  );
  const row=(table,id)=>sqlite.prepare("SELECT * FROM "+table+" WHERE id=?").get(id);
  const countRows=table=>sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
  return {sqlite,stats,post,row,countRows,write,insertVideo};
}
const countEffects=s=>({
  audits:s.countRows("audit_logs"),outbox:s.countRows("notification_outbox"),
  queue:s.countRows("static_rebuild_queue"),
});

test("SA-056 U03f: 20 submitted slots -> available, complete video strict audit, one DM, three queues, one batch",async()=>{
  const s=setup({count:20});
  try{
    const res=await s.post();
    assert.equal(res.status,200,await res.clone().text());
    assert.equal(res.headers.get("Cache-Control"),"private, no-store");
    for(let i=0;i<20;i++){
      const saved=s.row("slots","s"+i);
      assert.equal(saved.status,"available");
      assert.equal(saved.reserved_by_user_id,null);
      assert.equal(saved.video_id,null);
      assert.equal(saved.reservation_group_id,null);
      assert.equal(saved.slot_label,"Keep");
      assert.equal(saved.version,2);
    }
    assert.equal(s.row("videos","vid").scheduling_type,"manual");
    assert.deepEqual(countEffects(s),{audits:21,outbox:1,queue:3});
    assert.equal(s.stats.batches,1);
    assert.equal(s.stats.reads<=3,true);
    const videoAudit=s.sqlite.prepare("SELECT * FROM audit_logs WHERE table_name='videos'").get();
    assert.equal(videoAudit.retention_class,"long_audit");
    const before=JSON.parse(videoAudit.before_json),after=JSON.parse(videoAudit.after_json);
    assert.equal(Object.keys(before).length,30);
    assert.equal(before.creator_profile_text,"Review complete 30 fields");
    assert.equal(after.scheduling_type,"manual");
    assert.equal(after.title,"Video title");
    const dm=s.sqlite.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(dm.type,"slot_force_released");
    assert.match(dm.dedupe_key,/slot_force_released:ev-1:s0:g:1:submitted/);
  }finally{s.sqlite.close();}
});
test("SA-057 U03f: reservation remains while video detaches, long audits and second DM type",async()=>{
  const s=setup({kind:"keep-reservation"});
  try{
    const res=await s.post("s1");
    assert.equal(res.status,200,await res.clone().text());
    for(const id of ["s0","s1"]){
      const saved=s.row("slots",id);
      assert.equal(saved.status,"reserved");
      assert.equal(saved.reserved_by_user_id,"recipient-1");
      assert.equal(saved.reservation_group_id,"g  ");
      assert.equal(saved.video_id,null);
      assert.equal(saved.version,2);
    }
    assert.equal(s.row("videos","vid").scheduling_type,"manual");
    assert.deepEqual(countEffects(s),{audits:3,outbox:1,queue:3});
    const dm=s.sqlite.prepare("SELECT type,dedupe_key,payload_json FROM notification_outbox").get();
    assert.equal(dm.type,"slot_submission_released");
    assert.match(dm.dedupe_key,/:s1:g:1:submitted$/);
    assert.equal(JSON.parse(dm.payload_json).url,ORIGIN+"/event/ev-1/slots");
    assert.equal(s.stats.batches,1);
  }finally{s.sqlite.close();}
});
test("SA-056/057 U03f: other submitted reference blocks manual schedule but not this group",async()=>{
  for(const kind of ["force-release","keep-reservation"]){
    const s=setup({kind,mutate:({write})=>write(slot("outside",{
      reservation_group_id:"else",sort_order:999,
    }))});
    try{
      const res=await s.post();
      assert.equal(res.status,200,await res.clone().text());
      assert.equal(s.row("videos","vid").scheduling_type,"slotted");
      assert.equal(s.row("slots","outside").status,"submitted");
      assert.equal(s.countRows("audit_logs"),2);
      assert.equal(s.countRows("notification_outbox"),1);
    }finally{s.sqlite.close();}
  }
});
test("SA-056/057 U03f: linked approved staff allowed; denied staff cannot inspect event existence",async()=>{
  const denied=setup({actor:STAFF});
  try{
    assert.equal((await denied.post()).status,404);
    assert.equal((await denied.post("s0","missing")).status,404);
    assert.deepEqual(countEffects(denied),{audits:0,outbox:0,queue:0});
    assert.equal(denied.stats.batches,0);
    assert.equal(denied.stats.reads,2);
  }finally{denied.sqlite.close();}
  const allowed=setup({actor:STAFF,staff:true});
  try{
    assert.equal((await allowed.post()).status,200);
    assert.equal(allowed.countRows("audit_logs"),3);
  }finally{allowed.sqlite.close();}
});
test("SA-056/057 U03f: group phantom after read aborts entire strict batch",async()=>{
  for(const kind of ["force-release","keep-reservation"]){
    let injected=false;
    const s=setup({kind,onFirst:(sql,sqlite)=>{
      if(!injected && sql.includes("AS group_json")){
        injected=true;
        const extra=slot("phantom",{status:"reserved"});
        sqlite.prepare("INSERT INTO slots VALUES ("+cols.map(()=>"?").join(",")+")")
          .run(...cols.map(k=>extra[k]));
      }
    }});
    try{
      const res=await s.post();
      assert.equal(injected,true);
      assert.equal(res.status,409,await res.clone().text());
      assert.equal(s.row("slots","s0").status,"submitted");
      assert.deepEqual(countEffects(s),{audits:0,outbox:0,queue:0});
    }finally{s.sqlite.close();}
  }
});
test("SA-056/057 U03f: post-read new submitted video ref aborts before slot DML",async()=>{
  let injected=false;
  const s=setup({onFirst:(sql,sqlite)=>{
    if(!injected && sql.includes("AS refs_json")){
      injected=true;
      const extra=slot("new-ref",{reservation_group_id:"other"});
      sqlite.prepare("INSERT INTO slots VALUES ("+cols.map(()=>"?").join(",")+")")
        .run(...cols.map(k=>extra[k]));
    }
  }});
  try{
    const res=await s.post();
    assert.equal(injected,true);
    assert.equal(res.status,409,await res.clone().text());
    assert.equal(s.row("slots","s0").status,"submitted");
    assert.equal(s.row("videos","vid").scheduling_type,"slotted");
    assert.deepEqual(countEffects(s),{audits:0,outbox:0,queue:0});
  }finally{s.sqlite.close();}
});
test("SA-056/057 U03f: stale video title without updated_at bump fails full 30-field CAS",async()=>{
  for(const kind of ["force-release","keep-reservation"]){
    let injected=false;
    const s=setup({kind,onFirst:(sql,sqlite)=>{
      if(!injected && sql.includes("AS refs_json")){
        injected=true;
        sqlite.prepare("UPDATE videos SET title=? WHERE id=?")
          .run("Concurrent title without timestamp update","vid");
      }
    }});
    try{
      const res=await s.post();
      assert.equal(injected,true);
      assert.equal(res.status,409,await res.clone().text());
      assert.equal(s.row("videos","vid").title,"Concurrent title without timestamp update");
      assert.equal(s.row("videos","vid").scheduling_type,"slotted");
      assert.equal(s.row("slots","s0").status,"submitted");
      assert.deepEqual(countEffects(s),{audits:0,outbox:0,queue:0});
      assert.equal(s.stats.batches,1);
    }finally{s.sqlite.close();}
  }
});

test("SA-056/057 U03f: missing strict audit table rolls back slot, video, Outbox, Queue",async()=>{
  const s=setup();
  try{
    s.sqlite.exec("DROP TABLE audit_logs");
    const res=await s.post();
    assert.equal(res.status,503,await res.clone().text());
    for(const id of ["s0","s1"])assert.equal(s.row("slots",id).status,"submitted");
    assert.equal(s.row("videos","vid").scheduling_type,"slotted");
    assert.equal(s.countRows("notification_outbox"),0);
    assert.equal(s.countRows("static_rebuild_queue"),0);
  }finally{s.sqlite.close();}
});
test("SA-056/057 U03f: opted-out recipient, CostGuard and anonymous have no unwanted effects",async()=>{
  const opted=setup();
  try{
    opted.sqlite.prepare('UPDATE "user" SET is_notification_enabled=0 WHERE id=?')
      .run("recipient-1");
    assert.equal((await opted.post()).status,200);
    assert.equal(opted.countRows("notification_outbox"),0);
    assert.equal(opted.countRows("audit_logs"),3);
  }finally{opted.sqlite.close();}
  for(const options of [{mode:"maintenance"},{actor:null}]){
    const s=setup(options);
    try{
      assert.ok([401,503].includes((await s.post()).status));
      assert.deepEqual(countEffects(s),{audits:0,outbox:0,queue:0});
    }finally{s.sqlite.close();}
  }
});
test("SA-056/057 U03f: 21 members, invalid IDs and missing video fail closed",async()=>{
  const excess=setup({count:21});
  try{
    assert.equal((await excess.post()).status,409);
    assert.deepEqual(countEffects(excess),{audits:0,outbox:0,queue:0});
  }finally{excess.sqlite.close();}
  const missing=setup({seedVideo:false});
  try{
    assert.equal((await missing.post()).status,409);
    assert.equal((await missing.post("s0","missing")).status,404);
    assert.equal((await missing.post("bad!")).status,400);
    assert.deepEqual(countEffects(missing),{audits:0,outbox:0,queue:0});
  }finally{missing.sqlite.close();}
});
test("SA-056/057 U03f: no accidental managed route mount or immediate Queue wake",()=>{
  const s=readFileSync(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(s,/slotSubmittedDangerRoutes|slotSubmittedDanger\.ts/);
  const handler=readFileSync(new URL("../src/routes/manage/slotSubmittedDanger.ts",import.meta.url),"utf8");
  assert.doesNotMatch(handler,/notificationWakeSource|staticRebuildWakeSource|\.send\(/);
  assert.match(handler,/mutateWithAudit\(db,/);
  assert.match(handler,/preMutationAssertions:/);
  assert.match(handler,/postAuditStatements:/);
});

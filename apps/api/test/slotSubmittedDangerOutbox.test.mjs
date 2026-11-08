// MIG-0656 U03e: SA-056/057 CURRENT DM type, dedupe, opt-out and rollback.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { readFile } from "node:fs/promises";
import { selectSubmittedDangerSnapshot } from "../src/routes/manage/slotSubmittedDangerSelection.ts";
import {
  slotSubmissionReleasedPayload, buildSubmittedDangerOutboxStatements,
} from "../src/routes/manage/slotSubmittedDangerOutbox.ts";

const dialect=new SQLiteSyncDialect();
const slot=(id,patch={})=>({
  id,event_id:"ev",reserved_by_user_id:"u1",x_user_id:"x1",
  reserved_x_id_snapshot:"x1",display_name:"Owner",slot_label:"Keep",
  start_time:null,sort_order:0,reservation_group_id:"g  ",
  video_id:"vid",status:"submitted",updated_at:100,version:3,...patch,
});
function selection(kind,rows,requested=rows[0]){
  const s=selectSubmittedDangerSnapshot({
    kind,eventId:"ev",slotId:requested.id,anchor:requested,groupedRows:rows,
    videoBefore:{id:"vid",updated_at:400,scheduling_type:"slotted"},
    submittedVideoRefs:rows.map(row=>({id:row.id})),
  });
  assert.equal(s.ok,true,JSON.stringify(s));
  return s;
}
const options=(kind,rows,slotId=rows[0].id,makeId=()=>"dm")=>({
  kind,eventId:"ev",slotId,selection:selection(kind,rows,rows.find(r=>r.id===slotId)),
  createdAt:500,siteOrigin:"https://app.example",makeId,
});
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    'CREATE TABLE "user"(id TEXT PRIMARY KEY,is_notification_enabled INTEGER);',
    "INSERT INTO \"user\" VALUES ('u1',1),('u2',0);",
    "CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,recipient_user_id TEXT,",
    "type TEXT,payload_json TEXT,delivery_route TEXT,correlation_id TEXT,",
    "status TEXT,attempt_count INTEGER,processing_started_at INTEGER,",
    "lease_token TEXT,lease_expires_at INTEGER,next_attempt_at INTEGER,",
    "last_error TEXT,processed_at INTEGER,event_id TEXT,dedupe_key TEXT,created_at INTEGER);",
    "CREATE UNIQUE INDEX active_dedupe ON notification_outbox(dedupe_key)",
    "WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','sent');",
  ].join(" "));
  return db;
}
const exec=(db,stmt)=>{
  const compiled=dialect.sqlToQuery(stmt);
  assert.ok(compiled.params.length<=10);
  return db.prepare(compiled.sql).run(...compiled.params).changes;
};
const count=db=>db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n;

test("SA-056: submitted force-release DM keeps CURRENT :submitted dedupe and event URL",()=>{
  const db=setup();
  try {
    const out=buildSubmittedDangerOutboxStatements(options("force-release",[slot("a"),slot("b")]));
    assert.deepEqual(out.dedupeKeys,["slot_force_released:ev:a:g:3:submitted"]);
    assert.equal(out.statements.length,1);
    assert.equal(exec(db,out.statements[0]),1);
    const saved=db.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(saved.type,"slot_force_released");
    assert.equal(saved.recipient_user_id,"u1");
    assert.equal(saved.delivery_route,"dm");
    const payload=JSON.parse(saved.payload_json);
    assert.equal(payload.url,"https://app.example/event/ev");
    assert.match(payload.content,/予約枠 2 件/);
    assert.match(payload.content,/予約グループ: g/);
  } finally { db.close(); }
});
test("SA-057: keep-reservation DM uses distinct type, slot URL and content",()=>{
  const db=setup();
  try {
    const out=buildSubmittedDangerOutboxStatements(options("keep-reservation",[slot("a"),slot("b")]));
    assert.deepEqual(out.dedupeKeys,["slot_submission_released:ev:a:g:3:submitted"]);
    assert.equal(exec(db,out.statements[0]),1);
    const saved=db.prepare("SELECT type,payload_json FROM notification_outbox").get();
    assert.equal(saved.type,"slot_submission_released");
    const payload=JSON.parse(saved.payload_json);
    assert.equal(payload.url,"https://app.example/event/ev/slots");
    assert.match(payload.content,/作品提出が解除/);
    assert.match(payload.content,/予約枠自体は引き続き確保/);
    assert.match(payload.content,/提出グループ: g/);
    assert.match(payload.content,/2枠/);
  } finally { db.close(); }
});
test("SA-056/057: requested anchor not DB first group row controls dedupe version and id",()=>{
  const rows=[slot("a",{version:3}),slot("b",{version:7}),slot("c",{version:5})];
  for(const kind of ["force-release","keep-reservation"]){
    const out=buildSubmittedDangerOutboxStatements(options(kind,rows,"b"));
    assert.equal(out.dedupeKeys.length,1);
    assert.match(out.dedupeKeys[0],/:b:g:7:submitted$/);
  }
});
test("SA-056: 20-row group yields one DM; owner-less solo yields none",()=>{
  const rows=Array.from({length:20},(_,i)=>slot("s"+i));
  const out=buildSubmittedDangerOutboxStatements(options("force-release",rows));
  assert.equal(out.statements.length,1);
  assert.match(out.dedupeKeys[0],/slot_force_released/);
  const noOwner=slot("solo",{
    reservation_group_id:null,reserved_by_user_id:null,video_id:null,
  });
  const selected=selectSubmittedDangerSnapshot({
    kind:"force-release",eventId:"ev",slotId:"solo",anchor:noOwner,
    groupedRows:[],videoBefore:null,submittedVideoRefs:[],
  });
  assert.equal(selected.ok,true);
  const skipped=buildSubmittedDangerOutboxStatements({
    kind:"force-release",eventId:"ev",slotId:"solo",selection:selected,
    siteOrigin:"https://app.example",createdAt:500,
  });
  assert.deepEqual(skipped,{statements:[],dedupeKeys:[]});
});
test("SA-056/057: opted-out, missing recipient, active dedupe and failed retry",()=>{
  const db=setup();
  try{
    for(const kind of ["force-release","keep-reservation"]){
      const opted=buildSubmittedDangerOutboxStatements(options(
        kind,[slot("opted",{reserved_by_user_id:"u2"})],
      ));
      assert.equal(exec(db,opted.statements[0]),0);
      const missing=buildSubmittedDangerOutboxStatements(options(
        kind,[slot("missing",{reserved_by_user_id:"missing"})],
      ));
      assert.equal(exec(db,missing.statements[0]),0);
    }
    assert.equal(count(db),0);
    const first=buildSubmittedDangerOutboxStatements(options("force-release",[slot("a")],"a",()=>"a1"));
    const duplicate=buildSubmittedDangerOutboxStatements(options("force-release",[slot("a")],"a",()=>"a2"));
    assert.equal(exec(db,first.statements[0]),1);
    assert.equal(exec(db,duplicate.statements[0]),0);
    db.prepare("UPDATE notification_outbox SET status='failed'").run();
    assert.equal(exec(db,duplicate.statements[0]),1);
    assert.equal(count(db),2);
  } finally{ db.close(); }
});
test("SA-056/057: Unicode-blank solo group, arbitrary mentions and invalid origins",()=>{
  const solo=slot("a",{reservation_group_id:"\u3000"});
  const out=buildSubmittedDangerOutboxStatements(options("keep-reservation",[solo]));
  assert.deepEqual(out.dedupeKeys,["slot_submission_released:ev:a:solo:3:submitted"]);
  const p=slotSubmissionReleasedPayload("ev",["a"],null,"https://app.example");
  assert.doesNotMatch(p.content,/提出グループ:/);
  for(const siteOrigin of [
    "javascript:alert(1)","https://app.example/path","https://user:pass@app.example",
    "https://app.example/#fragment",
  ]){
    assert.throws(()=>buildSubmittedDangerOutboxStatements({
      ...options("keep-reservation",[slot("a")]),siteOrigin,
    }),/invalid|URL/i);
  }
});
test("SA-056/057: invalid or mixed group and false selected snapshot are rejected",()=>{
  const a=slot("a"),b=slot("b");
  const valid=options("force-release",[a,b]);
  const cases=[
    {...valid,slotId:"missing"},{...valid,eventId:" ev "},
    {...valid,kind:"invalid"},{...valid,createdAt:NaN},
    {...valid,selection:{ok:false,message:"stale"}},
    {...valid,selection:{...valid.selection,rows:[a,a]}},
    {...valid,selection:{...valid.selection,rows:[a,slot("b",{reserved_by_user_id:"u2"})]}},
    {...valid,selection:{...valid.selection,groupId:"wrong"}},
    {...valid,selection:{...valid.selection,rows:[a,slot("b",{reservation_group_id:"other"})]}},
  ];
  for(const input of cases)assert.throws(()=>buildSubmittedDangerOutboxStatements(input));
});
test("SA-056/057: notification post-audit failure causes transaction rollback",()=>{
  const db=setup();
  try {
    const out=buildSubmittedDangerOutboxStatements(options("keep-reservation",[slot("a")]));
    db.exec("BEGIN");
    let error;
    try {
      assert.equal(exec(db,out.statements[0]),1);
      db.prepare("INSERT INTO missing_strict_audit VALUES (1)").run();
      db.exec("COMMIT");
    }catch(e){error=e;db.exec("ROLLBACK");}
    assert.match(String(error),/no such table/);
    assert.equal(count(db),0);
  }finally{db.close();}
});
test("SA-056/057: SQL builder never mounts a Hono route",async()=>{
  const s=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(s,/slotSubmittedDangerOutbox|slotSubmittedDangerRoutes/);
});

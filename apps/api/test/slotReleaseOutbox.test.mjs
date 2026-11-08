// MIG-0656 U02c-2b: SA-063 outbox SQL has no external pre-read or wake.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildSlotBatchAtomicPlan } from "../src/routes/manage/slotWriteMutations.ts";
import {
  buildSlotReleaseOutboxStatements, slotReleaseNotificationPayload,
} from "../src/routes/manage/slotReleaseOutbox.ts";

const dialect = new SQLiteSyncDialect();
const row=(id, group=null, owner="u1", props={})=>({
  id, event_id:"ev-1", reserved_by_user_id:owner, x_user_id:"x1",
  reserved_x_id_snapshot:"x1", status:"reserved", version:3, updated_at:100,
  reservation_group_id:group, ...props,
});
function setup(){
  const db=new DatabaseSync(":memory:");
  db.exec([
    'CREATE TABLE "user"(id TEXT PRIMARY KEY, is_notification_enabled INTEGER);',
    "INSERT INTO \"user\" VALUES ('u1',1),('u2',0);",
    "CREATE TABLE notification_outbox(",
    "id TEXT PRIMARY KEY,recipient_user_id TEXT,type TEXT,payload_json TEXT,",
    "delivery_route TEXT,correlation_id TEXT,status TEXT,attempt_count INTEGER,",
    "processing_started_at INTEGER,lease_token TEXT,lease_expires_at INTEGER,",
    "next_attempt_at INTEGER,last_error TEXT,processed_at INTEGER,event_id TEXT,",
    "dedupe_key TEXT,created_at INTEGER);",
    "CREATE UNIQUE INDEX active_dedupe ON notification_outbox(dedupe_key)",
    "WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','sent');",
    "CREATE TABLE slots(id TEXT PRIMARY KEY,event_id TEXT,status TEXT,version INTEGER,",
    "updated_at INTEGER,reserved_x_id_snapshot TEXT,reserved_by_user_id TEXT,",
    "x_user_id TEXT,reservation_group_id TEXT,display_name TEXT,video_id TEXT);",
  ].join(" "));
  return db;
}
const opts=(rows)=>({
  eventId:"ev-1",rows,siteOrigin:"https://flamenode.example",createdAt:123,
  makeId:(()=>{let n=0;return()=> "notif-"+(++n);})(),
});
function run(db,query){
  const compiled=dialect.sqlToQuery(query);
  assert.ok(compiled.params.length<=100,"D1 bind cap");
  return db.prepare(compiled.sql).run(...compiled.params).changes;
}
test("SA-063 U02c-2b: grouped slots create one DM with CURRENT dedupe and payload",()=>{
  const db=setup();
  try{
    const value=buildSlotReleaseOutboxStatements(opts([row("a","g  "),row("b","g  ")]));
    assert.equal(value.statements.length,1);
    assert.deepEqual(value.dedupeKeys,["slot_force_released:ev-1:a:g:3"]);
    assert.equal(run(db,value.statements[0]),1);
    const inserted=db.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(inserted.recipient_user_id,"u1");
    assert.equal(inserted.type,"slot_force_released");
    assert.equal(inserted.delivery_route,"dm");
    const payload=JSON.parse(inserted.payload_json);
    assert.equal(payload.url,"https://flamenode.example/event/ev-1");
    assert.match(payload.content,/予約枠 2 件/);
    assert.match(payload.content,/予約グループ: g/);
  } finally {db.close();}
});
test("SA-063 U02c-2b: CURRENT groups raw IDs with identical trimmed keys into one notification",()=>{
  const db=setup();
  try{
    const value=buildSlotReleaseOutboxStatements(opts([
      row("a","g  "),row("b","g"),
    ]));
    assert.equal(value.statements.length,1);
    assert.deepEqual(value.dedupeKeys,["slot_force_released:ev-1:a:g:3"]);
    assert.equal(run(db,value.statements[0]),1);
    const payload=JSON.parse(db.prepare("SELECT payload_json FROM notification_outbox").get().payload_json);
    assert.match(payload.content,/対象枠数: 2/);
  }finally{db.close();}
});
test("SA-063 U02c-2b: two solo reservations create separate dedupe keys",()=>{
  const db=setup();
  try{
    const value=buildSlotReleaseOutboxStatements(opts([row("a"),row("b")]));
    assert.equal(value.statements.length,2);
    assert.equal(new Set(value.dedupeKeys).size,2);
    for(const sql of value.statements)assert.equal(run(db,sql),1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notification_outbox").get().n,2);
  } finally{db.close();}
});
test("SA-063 U02c-2b: opted-out or absent recipient produces no outbox",()=>{
  const db=setup();
  try{
    for(const owner of ["u2","missing"]){
      const value=buildSlotReleaseOutboxStatements(opts([row("a",null,owner)]));
      assert.equal(value.statements.length,1);
      assert.equal(run(db,value.statements[0]),0);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notification_outbox").get().n,0);
  } finally {db.close();}
});
test("SA-063 U02c-2b: active dedupe refuses, failed status permits later event retry",()=>{
  const db=setup();
  try{
    const first=buildSlotReleaseOutboxStatements(opts([row("a")]));
    assert.equal(run(db,first.statements[0]),1);
    const second=buildSlotReleaseOutboxStatements({
      ...opts([row("a")]),makeId:()=>"second-id",
    });
    assert.equal(run(db,second.statements[0]),0);
    db.prepare("UPDATE notification_outbox SET status='failed'").run();
    assert.equal(run(db,second.statements[0]),1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notification_outbox").get().n,2);
  }finally{db.close();}
});
test("SA-063 U02c-2b: invalid origin or mixed owners fails closed",()=>{
  for(const siteOrigin of ["javascript:alert(1)","https://flamenode.example/path"]){
    assert.throws(()=>buildSlotReleaseOutboxStatements({
      ...opts([row("a")]),siteOrigin,
    }),/slot_release_notification_origin_invalid/);
  }
  assert.throws(()=>buildSlotReleaseOutboxStatements(opts([
    row("a","g","u1"),row("b","g","u2"),
  ])),/slot_release_notification_mixed_owners/);
});
test("SA-063 U02c-2b: notification and CAS rollback if strict audit fails",()=>{
  const db=setup(),original=row("a");
  try{
    db.prepare("INSERT INTO slots VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      "a","ev-1","reserved",3,100,"x1","u1","x1",null,"Alice",null);
    const plan=buildSlotBatchAtomicPlan({
      kind:"release-reserved",eventId:"ev-1",rows:[original],updatedAt:200,
    });
    const outbox=buildSlotReleaseOutboxStatements(opts([original]));
    let reachedAuditFailure=false;
    let observedError=null;
    db.exec("BEGIN");
    try{
      for(const assertion of plan.preMutationAssertions){
        const compiled=dialect.sqlToQuery(assertion);
        db.prepare(compiled.sql).get(...compiled.params);
      }
      assert.equal(run(db,plan.mutationStatement),1);
      assert.equal(run(db,outbox.statements[0]),1);
      reachedAuditFailure=true;
      db.prepare("INSERT INTO audit_logs_missing VALUES (1)").run();
      db.exec("COMMIT");
    }catch(error){
      observedError=error;
      db.exec("ROLLBACK");
    }
    assert.equal(reachedAuditFailure,true,"precondition, CAS and outbox must succeed before audit fails");
    assert.match(String(observedError),/no such table: audit_logs_missing/);
    assert.equal(db.prepare("SELECT status FROM slots WHERE id='a'").get().status,"reserved");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notification_outbox").get().n,0);
  }finally{db.close();}
});
test("SA-063 U02c-2b: payload uses only configured public origin",()=>{
  const payload=slotReleaseNotificationPayload("ev-1",["a","b"],null,"https://flamenode.example");
  assert.equal(payload.event_id,"ev-1");
  assert.equal(payload.url,"https://flamenode.example/event/ev-1");
  assert.match(payload.content,/対象枠数: 2/);
  assert.match(payload.content,/イベントページを開く\nhttps:\/\/flamenode.example\/event\/ev-1/);
});

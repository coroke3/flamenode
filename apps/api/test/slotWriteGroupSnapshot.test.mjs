import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SLOT_BATCH_RELEASE_SNAPSHOT_SQL, selectBatchReservedReleaseSnapshot } from "../src/routes/manage/slotWriteGroupSnapshot.ts";
import { SLOT_BATCH_WRITE_SNAPSHOT_SQL } from "../src/routes/manage/slotWriteScopedRead.ts";

const cols=["id","event_id","reserved_by_user_id","x_user_id","reserved_x_id_snapshot",
  "display_name","slot_label","start_time","sort_order","reservation_group_id",
  "video_id","status","updated_at","version"];
function row(id,{group=null,owner="u1",event="e1",status="reserved"}={}) {
  return {id,event_id:event,reserved_by_user_id:owner,x_user_id:owner,
    reserved_x_id_snapshot:owner,display_name:"Name",slot_label:null,
    start_time:null,sort_order:0,reservation_group_id:group,video_id:null,
    status,updated_at:100,version:1};
}
function setup(rows) {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE events(id TEXT PRIMARY KEY);",
    "CREATE TABLE event_staff(event_id TEXT,x_user_id TEXT,permission_preset TEXT,custom_permission_keys_json TEXT);",
    "CREATE TABLE x_user_account_links(auth_user_id TEXT,x_user_id TEXT);",
    "CREATE TABLE x_users(id TEXT,approval_status TEXT);",
    "CREATE TABLE system_settings (id TEXT PRIMARY KEY,operation_mode TEXT,disabled_features_json TEXT,",
    "cost_guard_exception_until INTEGER,cost_guard_exception_features_json TEXT);",
    "INSERT INTO system_settings (id,operation_mode) VALUES ('default','normal');",
    "CREATE TABLE slots(id TEXT PRIMARY KEY,event_id TEXT,reserved_by_user_id TEXT,x_user_id TEXT,",
    "reserved_x_id_snapshot TEXT,display_name TEXT,slot_label TEXT,start_time INTEGER,",
    "sort_order INTEGER,reservation_group_id TEXT,video_id TEXT,status TEXT,updated_at INTEGER,version INTEGER);",
    "INSERT INTO events(id) VALUES ('e1'),('e2');",
  ].join(" "));
  const insert=db.prepare("INSERT INTO slots VALUES ("+cols.map(()=>"?").join(",")+")");
  for(const item of rows) insert.run(...cols.map(k=>item[k]));
  return db;
}
const read=(db,ids,eventId="e1")=>db.prepare(SLOT_BATCH_RELEASE_SNAPSHOT_SQL).get(
  eventId,eventId,"staff",eventId,JSON.stringify(ids),
  eventId,eventId,JSON.stringify(ids));
const plan=(db,ids,eventId="e1")=>selectBatchReservedReleaseSnapshot(eventId,ids,read(db,ids,eventId));
test("SA-063 U02c-2a: snapshot SQL columns match SA-062/064 audited snapshot",()=>{
  const names=sql=>Array.from(sql.matchAll(/'([^']+)', s\."([^"]+)"/g),m=>m[1]+":"+m[2]).sort();
  const canonical=names(SLOT_BATCH_WRITE_SNAPSHOT_SQL);
  assert.equal(canonical.length,14);
  assert.deepEqual(names(SLOT_BATCH_RELEASE_SNAPSHOT_SQL),[...canonical,...canonical].sort());
});
test("SA-063 U02c-2a: one read expands raw whitespace-preserved group",()=>{
  const db=setup([row("a",{group:"g  "}),row("b",{group:"g  "}),row("solo")]);
  try{
    const r=read(db,["a"]);
    assert.equal(r.exists_id,"e1");
    assert.equal(JSON.parse(r.cost_guard_json).operation_mode,"normal");
    assert.equal(JSON.parse(r.slots_json).length,1);
    assert.equal(JSON.parse(r.grouped_slots_json).length,2);
    const v=selectBatchReservedReleaseSnapshot("e1",["a"],r);
    assert.equal(v.ok,true);
    if(v.ok)assert.deepEqual(v.rows.map(x=>x.id).sort(),["a","b"]);
  }finally{db.close();}
});
test("SA-063 U02c-2a: >3-member group is rejected by four-row sentinel",()=>{
  const db=setup(["a","b","c","d","e"].map(id=>row(id,{group:"g"})));
  try{
    const r=read(db,["a"]);
    assert.equal(JSON.parse(r.grouped_slots_json).length,4);
    assert.equal(selectBatchReservedReleaseSnapshot("e1",["a"],r).ok,false);
  }finally{db.close();}
});
test("SA-063 U02c-2a: mixed owners or nonreserved group member rejected",()=>{
  for(const b of [row("b",{group:"g",owner:"u2"}),row("b",{group:"g",status:"submitted"})]){
    const db=setup([row("a",{group:"g"}),b]);
    try{assert.equal(plan(db,["a"]).ok,false);}finally{db.close();}
  }
});
test("SA-063 U02c-2a: Unicode whitespace-only group is solo",()=>{
  const db=setup([row("a",{group:"\u2003"}),row("b",{group:"\u2003"})]);
  try{
    const p=plan(db,["a"]);
    assert.equal(p.ok,true);
    if(p.ok)assert.deepEqual(p.rows.map(x=>x.id),["a"]);
  }finally{db.close();}
});
test("SA-063 U02c-2a: cross-event group member excluded",()=>{
  const db=setup([row("a",{group:"g"}),row("b",{group:"g",event:"e2"})]);
  try{
    const r=read(db,["a"]);
    assert.equal(JSON.parse(r.grouped_slots_json).length,1);
    const p=selectBatchReservedReleaseSnapshot("e1",["a"],r);
    assert.equal(p.ok,true);
    if(p.ok)assert.deepEqual(p.rows.map(x=>x.id),["a"]);
    assert.equal(plan(db,["b"]).ok,false);
  }finally{db.close();}
});
test("SA-063 U02c-2a: missing/nonreserved selections refuse release",()=>{
  const db=setup([row("a"),row("b",{status:"available"})]);
  try{
    for(const ids of [["missing"],["a","missing"],["b"]])
      assert.equal(plan(db,ids).ok,false);
    assert.equal(plan(db,["a"]).ok,true);
  }finally{db.close();}
});

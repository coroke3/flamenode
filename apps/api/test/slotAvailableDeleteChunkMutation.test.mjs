// MIG-0656 U02c-6b: SA-059 offline-only 3-row CAS plan / partial progress.
// No HTTP endpoint is mounted; this is NOT the all-available deletion protocol.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL,
  selectAvailableDeleteChunk,
} from "../src/routes/manage/slotAvailableDeleteChunkSnapshot.ts";
import {
  buildAvailableDeleteChunkAtomicPlan,
} from "../src/routes/manage/slotAvailableDeleteChunkMutation.ts";
import {
  SLOT_CHUNK_COST_GUARD_SELECT,
  verifySlotChunkCostGuard,
  buildSlotChunkCostGuardAssertion,
} from "../src/routes/manage/slotChunkCostGuard.ts";

const dialect = new SQLiteSyncDialect();
const cols = [
  "id","event_id","reserved_by_user_id","x_user_id","reserved_x_id_snapshot",
  "display_name","slot_label","start_time","sort_order",
  "reservation_group_id","video_id","status","updated_at","version",
];
const slot = (id, patch = {}) => ({
  id, event_id:"ev", reserved_by_user_id:null, x_user_id:null,
  reserved_x_id_snapshot:null, display_name:null, slot_label:"Keep",
  start_time:null, sort_order:0, reservation_group_id:null,
  video_id:null, status:"available", updated_at:100, version:1, ...patch,
});
function setup(rows) {
  const db=new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE events(id TEXT PRIMARY KEY);",
    "INSERT INTO events VALUES('ev');",
    "CREATE TABLE event_staff(event_id TEXT,x_user_id TEXT,permission_preset TEXT,custom_permission_keys_json TEXT);",
    "CREATE TABLE x_user_account_links(auth_user_id TEXT,x_user_id TEXT);",
    "CREATE TABLE x_users(id TEXT PRIMARY KEY,approval_status TEXT);",
    // The U03w bounded snapshot now reads the CostGuard policy in this same SELECT.
    "CREATE TABLE system_settings(id TEXT PRIMARY KEY,operation_mode TEXT,disabled_features_json TEXT,cost_guard_exception_until INTEGER,cost_guard_exception_features_json TEXT);",
    "INSERT INTO system_settings VALUES('default','normal',NULL,NULL,NULL);",
    "CREATE TABLE slots(" + cols.map(c => c==="id" ? "id TEXT PRIMARY KEY" :
      ["start_time","sort_order","updated_at","version"].includes(c) ?
        c+" INTEGER" : c+" TEXT").join(",") + ");",
  ].join(" "));
  const insert = db.prepare("INSERT INTO slots VALUES(" + cols.map(()=>"?").join(",") + ")");
  const write = row => insert.run(...cols.map(c=>row[c]));
  for(const row of rows) write(row);
  return {db,write};
}
function read(db) {
  const result=db.prepare(SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL)
    .get("ev","ev","actor","ev");
  return selectAvailableDeleteChunk("ev",result);
}
function count(db,eventId="ev",status="available") {
  return db.prepare("SELECT COUNT(*) AS n FROM slots WHERE event_id=? AND status=?")
    .get(eventId,status).n;
}
function commitChunk(db,selection) {
  const plan=buildAvailableDeleteChunkAtomicPlan({eventId:"ev",selection});
  const sql=dialect.sqlToQuery(plan.mutationStatement);
  db.exec("BEGIN");
  try {
    const changed=db.prepare(sql.sql).run(...sql.params).changes;
    if(changed!==plan.expectedMutationChanges)throw Error("exact_changed_rows_mismatch");
    db.exec("COMMIT");
    return {plan,changed};
  } catch(e) {
    db.exec("ROLLBACK");throw e;
  }
}

test("SA-059 11 available -> four bounded 3/3/3/2 CAS batches, never 11 in one", () => {
  const {db}=setup([
    ...Array.from({length:11},(_,i)=>slot("a"+String(i).padStart(2,"0"))),
    slot("reserved",{status:"reserved"}),
    slot("foreign",{event_id:"other"}),
  ]);
  try {
    const sizes=[],seenMore=[];
    for(let i=0;i<4;i++){
      const selection=read(db);
      assert.equal(selection.ok,true);
      if(!selection.ok)throw Error("bad read");
      const {plan,changed}=commitChunk(db,selection);
      assert.ok(changed>=1&&changed<=3);
      sizes.push(changed);
      seenMore.push(plan.moreAtSnapshot);
      assert.equal(plan.preMutationAssertions.length,0);
      assert.equal(plan.processedCount,changed);
    }
    assert.deepEqual(sizes,[3,3,3,2]);
    assert.deepEqual(seenMore,[true,true,true,false]);
    assert.equal(count(db),0);
    assert.equal(count(db,"ev","reserved"),1);
    assert.equal(count(db,"other"),1);
    assert.equal(read(db).ok,true);
    assert.throws(()=>buildAvailableDeleteChunkAtomicPlan({
      eventId:"ev",selection:read(db),
    }),/slot_available_delete_chunk_invalid_selection/);
  }finally{db.close();}
});

test("SA-059 post-read version race rolls back ALL selected deletion",()=>{
  const {db}=setup([slot("a"),slot("b"),slot("c")]);
  try{
    const selection=read(db);
    assert.equal(selection.ok,true);
    db.prepare("UPDATE slots SET version=version+1 WHERE id='b'").run();
    assert.throws(()=>commitChunk(db,selection),/exact_changed_rows_mismatch/);
    assert.equal(count(db),3);
    assert.equal(db.prepare("SELECT version FROM slots WHERE id='b'").get().version,2);
  }finally{db.close();}
});

test("SA-059 reservation race rejects even with an unchanged version",()=>{
  const {db}=setup([slot("a"),slot("b")]);
  try{
    const selection=read(db);
    assert.equal(selection.ok,true);
    db.prepare("UPDATE slots SET status='reserved' WHERE id='b'").run();
    assert.throws(()=>commitChunk(db,selection),/exact_changed_rows_mismatch/);
    assert.equal(count(db),1);
    assert.equal(count(db,"ev","reserved"),1);
    assert.equal(db.prepare("SELECT id FROM slots WHERE status='available'").get().id,"a");
  }finally{db.close();}
});

test("SA-059 U03m: replaying a committed snapshot fails without deleting the next chunk",()=>{
  // The same stale chunk MUST NOT silently advance into the next three slots
  // after a lost HTTP response. Fresh selection is a distinct command.
  const {db}=setup(["a","b","c","d","e","f"].map(id=>slot(id)));
  try{
    const selected=read(db);
    assert.equal(selected.ok,true);
    if(!selected.ok)throw Error("bad initial read");
    assert.deepEqual(selected.rows.map(row=>row.id),["a","b","c"]);
    assert.equal(selected.hasMore,true);
    const {changed}=commitChunk(db,selected);
    assert.equal(changed,3);
    assert.equal(count(db),3);
    assert.throws(()=>commitChunk(db,selected),/exact_changed_rows_mismatch/);
    assert.equal(count(db),3,"a stale replay cannot delete next three rows");
    const stillPresent=db.prepare("SELECT id FROM slots ORDER BY id").all()
      .map(row=>row.id);
    assert.deepEqual(stillPresent,["d","e","f"]);
    const next=read(db);
    assert.equal(next.ok,true);
    if(!next.ok)throw Error("bad continuation read");
    assert.equal(next.hasMore,false);
    assert.deepEqual(next.rows.map(row=>row.id),["d","e","f"]);
    assert.equal(commitChunk(db,next).changed,3);
    assert.equal(count(db),0);
  }finally{db.close();}
});

test("SA-059 read-time hasMore is NOT an authoritative completion signal",()=>{
  const {db,write}=setup([slot("a")]);
  try{
    const selected=read(db);
    assert.equal(selected.ok,true);
    if(!selected.ok)throw Error("bad read");
    assert.equal(selected.hasMore,false);
    write(slot("b"));
    const {plan}=commitChunk(db,selected);
    assert.equal(plan.moreAtSnapshot,false);
    assert.equal(count(db),1,"a concurrent new slot may remain after the first chunk");
    const next=read(db);
    assert.equal(next.ok,true);
    if(!next.ok)throw Error("bad next read");
    assert.deepEqual(next.rows.map(row=>row.id),["b"]);
  }finally{db.close();}
});

test("SA-058/059 U03y: only an essential CostGuard exception expires at atomic-batch time",()=>{
  // A controlled earlier verifier time models delay between the approved
  // D1 pre-read and the in-batch SQLite strftime('%s','now') check.
  const {db}=setup([]);
  try{
    const now=Math.floor(Date.now()/1000);
    const setPolicy=(mode,until,disabled=null)=>{
      db.prepare("UPDATE system_settings SET operation_mode=?,cost_guard_exception_until=?,disabled_features_json=?,cost_guard_exception_features_json=? WHERE id='default'")
        .run(mode,until,disabled,JSON.stringify(["manage_slot_delete"]));
      return db.prepare("SELECT "+SLOT_CHUNK_COST_GUARD_SELECT).get().cost_guard_json;
    };
    const assertBatch=(approval,shouldPass)=>{
      assert.equal(approval.approved,true);
      const stmt=dialect.sqlToQuery(buildSlotChunkCostGuardAssertion(approval));
      const run=()=>db.prepare(stmt.sql).all(...stmt.params);
      if(shouldPass)assert.doesNotThrow(run);
      else assert.throws(run,/malformed JSON/);
    };
    // Read-only mode requires a live exception. The unchanged DB row cannot
    // authorize a mutation once wall-clock time reaches its deadline.
    const modePolicy=setPolicy("read_only",now-10);
    const modeApproval=verifySlotChunkCostGuard(modePolicy,"manage_slot_delete",now-100);
    assert.equal(modeApproval.approved,true);
    assert.equal(modeApproval.exceptionDeadline,now-10);
    assertBatch(modeApproval,false);
    // Normal mode with this feature ENABLED does not depend on the exception.
    // Its expiry must not create a spurious conflict/partial operation.
    const normalPolicy=setPolicy("normal",now-10);
    const normalApproval=verifySlotChunkCostGuard(normalPolicy,"manage_slot_delete",now-100);
    assert.equal(normalApproval.approved,true);
    assert.equal(normalApproval.exceptionDeadline,null);
    assertBatch(normalApproval,true);
    // A disabled feature remains dependent on the temporary exception,
    // even in otherwise normal mode.
    const disabledPolicy=setPolicy("normal",now-10,JSON.stringify(["manage_slot_delete"]));
    const disabledApproval=verifySlotChunkCostGuard(disabledPolicy,"manage_slot_delete",now-100);
    assert.equal(disabledApproval.approved,true);
    assert.equal(disabledApproval.exceptionDeadline,now-10);
    assertBatch(disabledApproval,false);
    // Before the deadline, an unchanged policy must remain authorized.
    const activePolicy=setPolicy("read_only",now+600);
    const activeApproval=verifySlotChunkCostGuard(activePolicy,"manage_slot_delete",now);
    assert.equal(activeApproval.approved,true);
    assert.equal(activeApproval.exceptionDeadline,now+600);
    assertBatch(activeApproval,true);
  }finally{db.close();}
});

test("SA-059 invalid selections cannot produce a D1 mutation statement",()=>{
  const a=slot("a"),b=slot("b");
  for(const selection of [
    {ok:true,rows:[],hasMore:false},
    {ok:true,rows:[a,a],hasMore:true},
    {ok:true,rows:[a,b,slot("c"),slot("d")],hasMore:true},
    {ok:true,rows:[{...a,status:"reserved"}],hasMore:false},
    {ok:true,rows:[{...a,event_id:"foreign"}],hasMore:false},
    {ok:true,rows:[{...a,version:NaN}],hasMore:false},
    {ok:true,rows:[a],hasMore:"yes"},
    {ok:false,message:"read rejected"},
  ])assert.throws(()=>buildAvailableDeleteChunkAtomicPlan({
    eventId:"ev",selection,
  }),/slot_available_delete_chunk_invalid_/);
});

test("SA-059 SQL uses bound snapshot and candidate remains unmounted",async()=>{
  const plan=buildAvailableDeleteChunkAtomicPlan({
    eventId:"ev",selection:{ok:true,rows:[slot("a"),slot("b")],hasMore:true},
  });
  const query=dialect.sqlToQuery(plan.mutationStatement);
  assert.match(query.sql,/^\s*DELETE FROM slots/i);
  assert.match(query.sql,/json_each\(\?\)/);
  assert.ok(query.params.length<=4);
  const {readFile}=await import("node:fs/promises");
  const index=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotAvailableDeleteChunkMutation|slotAvailableDeleteChunkRoutes/);
});

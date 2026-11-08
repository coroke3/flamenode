// MIG-0656 U02c-7a: SA-058 three-row generated INSERT candidate, OFFLINE ONLY.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { materializeGeneratedSlotRows } from "../src/routes/manage/slotWritePlanning.ts";
import { buildGeneratedSlotChunkAtomicPlan, MAX_GENERATE_SLOT_CHUNK_ROWS } from "../src/routes/manage/slotGeneratedChunkMutation.ts";

const dialect = new SQLiteSyncDialect();
const cols = [
  "id","event_id","reserved_by_user_id","x_user_id","reserved_x_id_snapshot",
  "display_name","slot_label","start_time","sort_order",
  "reservation_group_id","video_id","status","updated_at","version",
];
const candidates = (mode, count, offset = 0) =>
  Array.from({ length: count }, (_, i) => mode === "time"
    ? {start_time:1000+(i+offset)*300,sort_order:i+offset,slot_label:null}
    : {start_time:null,sort_order:i+offset+1,slot_label:"No."+(i+offset+1)});
const materialize = (mode, n, offset=0) => {
  let next=offset;
  return materializeGeneratedSlotRows("ev",candidates(mode,n,offset),300,()=>"slot-"+String(next++));
};
function setup(rows=[]) {
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE slots (" + cols.map(c=>c==="id"?"id TEXT PRIMARY KEY":
    ["start_time","sort_order","updated_at","version"].includes(c)
      ?c+" INTEGER":c+" TEXT").join(",") + ");");
  const insert=db.prepare("INSERT INTO slots VALUES("+cols.map(()=>"?").join(",")+")");
  const add=row=>insert.run(...cols.map(k=>row[k]));
  for(const row of rows)add(row);
  return {db,add};
}
function execute(db,plan) {
  db.exec("BEGIN");
  try{
    for(const stmt of plan.preMutationAssertions){
      const q=dialect.sqlToQuery(stmt);
      const result=db.prepare(q.sql).get(...q.params);
      assert.equal(Object.values(result)[0],1);
    }
    const q=dialect.sqlToQuery(plan.mutationStatement);
    const changes=db.prepare(q.sql).run(...q.params).changes;
    if(changes!==plan.expectedMutationChanges)throw Error("exact_changes_mismatch");
    db.exec("COMMIT");
    return changes;
  }catch(e){db.exec("ROLLBACK");throw e;}
}
const read=(db,id)=>db.prepare("SELECT * FROM slots WHERE id=?").get(id);
const count=db=>db.prepare("SELECT COUNT(*) AS n FROM slots").get().n;

test("SA-058 count mode 3-row insert keeps CURRENT 14-field defaults",()=>{
  const {db}=setup();
  try{
    const rows=materialize("count",3);
    const p=buildGeneratedSlotChunkAtomicPlan({eventId:"ev",mode:"count",rows});
    assert.equal(p.expectedMutationChanges,3);
    assert.equal(p.processedCount,3);
    assert.equal(p.preMutationAssertions.length,1);
    assert.equal(execute(db,p),3);
    for(const row of rows){
      const saved=read(db,row.id);
      for(const col of cols)assert.equal(saved[col],row[col],col+" "+row.id);
    }
    assert.equal(MAX_GENERATE_SLOT_CHUNK_ROWS,3);
  }finally{db.close();}
});

test("SA-058 time mode inserts only complete timestamp candidates, same event",()=>{
  const {db}=setup();
  try{
    const rows=materialize("time",2);
    assert.equal(execute(db,buildGeneratedSlotChunkAtomicPlan({
      mode:"time",eventId:"ev",rows,
    })),2);
    assert.equal(count(db),2);
    assert.equal(read(db,"slot-0").start_time,1000);
    assert.equal(read(db,"slot-1").start_time,1300);
    assert.equal(read(db,"slot-0").sort_order,0);
    assert.equal(read(db,"slot-1").sort_order,1);
  }finally{db.close();}
});

test("SA-058 conflict with existing ANY status and same count sort_order fails closed",()=>{
  for(const status of ["available","reserved","submitted"]){
    const occupied=materialize("count",1)[0];
    const {db}=setup([{...occupied,id:"existing",status}]);
    try{
      const rows=materialize("count",3);
      const p=buildGeneratedSlotChunkAtomicPlan({eventId:"ev",mode:"count",rows});
      assert.throws(()=>execute(db,p),/malformed JSON|invalid-generated-slot-collision/i);
      assert.equal(count(db),1);
      assert.equal(read(db,"existing").status,status);
      for(const row of rows)assert.equal(read(db,row.id),undefined);
    }finally{db.close();}
  }
});

test("SA-058 time collision rejects even if existing order differs",()=>{
  const other={...materialize("time",1)[0],id:"occupied",sort_order:999,status:"reserved"};
  const {db}=setup([other]);
  try{
    const rows=materialize("time",2);
    assert.throws(()=>execute(db,buildGeneratedSlotChunkAtomicPlan({
      eventId:"ev",mode:"time",rows,
    })),/malformed JSON|invalid-generated-slot-collision/i);
    assert.equal(count(db),1);
  }finally{db.close();}
});

test("SA-058 collision created AFTER candidate validation but BEFORE same-batch SQL aborts",()=>{
  const {db,add}=setup();
  try{
    const rows=materialize("count",3);
    const p=buildGeneratedSlotChunkAtomicPlan({eventId:"ev",mode:"count",rows});
    add({...materialize("count",1)[0],id:"phantom",status:"submitted"});
    assert.throws(()=>execute(db,p),/malformed JSON|invalid-generated-slot-collision/i);
    assert.equal(count(db),1);
  }finally{db.close();}
});

test("SA-058 U03m: lost response replay cannot duplicate a committed chunk, even with fresh IDs",()=>{
  // Chunk-level fail-closed property ONLY: there is no approved resume token.
  for(const mode of ["count","time"]){
    const {db}=setup();
    try{
      const first=materialize(mode,3);
      const initial=buildGeneratedSlotChunkAtomicPlan({eventId:"ev",mode,rows:first});
      assert.equal(execute(db,initial),3);
      assert.equal(count(db),3);
      // The client does not know the original HTTP 200 was committed.
      // Regenerating UUIDs must not bypass the persisted order/time collision.
      const retry=materialize(mode,3).map((row,i)=>({
        ...row,id:"new-retry-"+mode+"-"+i,updated_at:301,
      }));
      const repeated=buildGeneratedSlotChunkAtomicPlan({eventId:"ev",mode,rows:retry});
      assert.throws(()=>execute(db,repeated),
        /malformed JSON|invalid-generated-slot-collision/i);
      assert.equal(count(db),3,mode+": replay must not insert any extra rows");
      for(const row of first)assert.deepEqual(read(db,row.id),
        Object.fromEntries(cols.map(k=>[k,row[k]])),mode+" "+row.id);
      for(const row of retry)assert.equal(read(db,row.id),undefined);
      // This is a new, NONOVERLAPPING chunk, not a retry or proof of
      // completion of the original potentially 100-row user request.
      const next=materialize(mode,2,3);
      assert.equal(execute(db,buildGeneratedSlotChunkAtomicPlan({
        eventId:"ev",mode,rows:next,
      })),2);
      assert.equal(count(db),5);
    }finally{db.close();}
  }
});

test("SA-058 previous successful chunks are separately committed, no all-100 claim",()=>{
  const {db}=setup();
  try {
    for(let offset=0;offset<7;offset+=3){
      const n=Math.min(3,7-offset);
      const rows=materialize("count",n,offset);
      assert.equal(execute(db,buildGeneratedSlotChunkAtomicPlan({
        eventId:"ev",mode:"count",rows,
      })),n);
      assert.equal(count(db),offset+n);
    }
    assert.equal(count(db),7);
    assert.equal(read(db,"slot-6").sort_order,7);
  }finally{db.close();}
});

test("SA-058 invalid modes, row defaults, duplicates and >3 reject before SQL",()=>{
  const good=materialize("count",2),one=good[0];
  const invalid=[
    {eventId:"ev",mode:"count",rows:[]},
    {eventId:"ev",mode:"count",rows:materialize("count",4)},
    {eventId:"ev",mode:"count",rows:[one,one]},
    {eventId:"ev",mode:"count",rows:[one,{...good[1],sort_order:one.sort_order}]},
    {eventId:"ev",mode:"time",rows:good},
    {eventId:" ev ",mode:"count",rows:good},
    {eventId:"other",mode:"count",rows:good},
    {eventId:"ev",mode:"count",rows:[{...one,status:"reserved"}]},
    {eventId:"ev",mode:"count",rows:[{...one,version:2}]},
    {eventId:"ev",mode:"count",rows:[{...one,reserved_by_user_id:"u"}]},
    {eventId:"ev",mode:"count",rows:[{...one,updated_at:1.1}]},
    {eventId:"ev",mode:"count",rows:[{...one,sort_order:NaN}]},
    {eventId:"ev",mode:"count",rows:[{...one,slot_label:123}]},
    {eventId:"ev",mode:"count",rows:[{...one,slot_label:null}]},
    {eventId:"ev",mode:"time",rows:[{...materialize("time",1)[0],slot_label:"incorrect"}]},
    {eventId:"ev",mode:"count",rows:[one,{...good[1],updated_at:301}]},
    {eventId:"ev",mode:"time",rows:[materialize("time",2)[0],{...materialize("time",2)[1],sort_order:0}]},
    {eventId:"ev",mode:"unknown",rows:good},
  ];
  for(const input of invalid)assert.throws(
    ()=>buildGeneratedSlotChunkAtomicPlan(input),undefined,JSON.stringify(input));
});

test("SA-058 D1 SQL remains bounded, prepared and UNMOUNTED",async()=>{
  const p=buildGeneratedSlotChunkAtomicPlan({
    eventId:"ev",mode:"count",rows:materialize("count",3),
  });
  const queries=[...p.preMutationAssertions,p.mutationStatement].map(q=>dialect.sqlToQuery(q));
  assert.ok(queries.every(q=>q.params.length<=4));
  assert.match(queries[0].sql,/json_each\(\?\)/);
  assert.match(queries[1].sql,/INSERT INTO slots/i);
  assert.match(queries[1].sql,/json_each\(\?\)/);
  const {readFile}=await import("node:fs/promises");
  const index=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotGeneratedChunkMutation|slotGeneratedChunkRoutes/);
});

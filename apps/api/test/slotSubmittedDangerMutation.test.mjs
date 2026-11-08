// MIG-0656 U03c: SA-056/057 same-batch group/ref/video CAS offline SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { readFile } from "node:fs/promises";
import { selectSubmittedDangerSnapshot } from "../src/routes/manage/slotSubmittedDangerSelection.ts";
import { buildSubmittedDangerAtomicPlan } from "../src/routes/manage/slotSubmittedDangerMutation.ts";

const dialect = new SQLiteSyncDialect();
const fields = [
  "id","event_id","reserved_by_user_id","x_user_id","reserved_x_id_snapshot",
  "display_name","slot_label","start_time","sort_order","reservation_group_id",
  "video_id","status","updated_at","version",
];
const slot = (id, patch = {}) => ({
  id,event_id:"ev",reserved_by_user_id:"owner",x_user_id:"x",
  reserved_x_id_snapshot:"x",display_name:"Person",slot_label:"Keep",
  start_time:100,sort_order:0,reservation_group_id:" raw  ",video_id:"vid",
  status:"submitted",updated_at:100,version:1,...patch,
});
const video = (patch={}) => ({
  id:"vid",updated_at:400,scheduling_type:"slotted",...patch,
});
function fixture(rows, vid = video()) {
  const db = new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE slots(" + fields.map(k => k==="id"?"id TEXT PRIMARY KEY":
      ["start_time","sort_order","updated_at","version"].includes(k)
        ?k+" INTEGER":k+" TEXT").join(",") + ");",
    "CREATE TABLE videos(id TEXT PRIMARY KEY, updated_at INTEGER, scheduling_type TEXT);",
  ].join(" "));
  const insert = db.prepare("INSERT INTO slots VALUES (" + fields.map(()=>"?").join(",") + ")");
  const add = row => insert.run(...fields.map(k => row[k]));
  for(const row of rows)add(row);
  if(vid)db.prepare("INSERT INTO videos VALUES (?,?,?)")
    .run(vid.id,vid.updated_at,vid.scheduling_type);
  return {db,add};
}
function selection(kind, rows, refs, vid = video()) {
  const parsed=selectSubmittedDangerSnapshot({
    kind,eventId:"ev",slotId:rows[0].id,anchor:rows[0],groupedRows:rows,
    videoBefore:vid,submittedVideoRefs:refs.map(id=>({id})),
  });
  assert.equal(parsed.ok,true,JSON.stringify(parsed));
  return parsed;
}
const q=statement=>dialect.sqlToQuery(statement);
function execute(db,plan,{failAudit=false}={}) {
  db.exec("BEGIN");
  try{
    for(const statement of plan.preMutationAssertions){
      const compiled=q(statement);
      const result=db.prepare(compiled.sql).get(...compiled.params);
      assert.equal(Object.values(result)[0],1,"atomic precondition");
    }
    const changes=[];
    for(let i=0;i<plan.mutationStatements.length;i++){
      const compiled=q(plan.mutationStatements[i]);
      const changed=db.prepare(compiled.sql).run(...compiled.params).changes;
      if(changed!==plan.expectedMutationChanges[i])throw Error("exact_changes_mismatch");
      changes.push(changed);
    }
    if(failAudit)throw Error("simulated_strict_audit_failure");
    db.exec("COMMIT");
    return changes;
  }catch(error){
    db.exec("ROLLBACK");
    throw error;
  }
}
const getSlot=(db,id)=>db.prepare("SELECT * FROM slots WHERE id=?").get(id);
const getVideo=db=>db.prepare("SELECT * FROM videos WHERE id='vid'").get();

test("SA-056: force release whole 20-member group and detach last submitted video",()=>{
  const rows=Array.from({length:20},(_,i)=>slot("slot-"+i,{sort_order:i}));
  const {db}=fixture(rows);
  try{
    const p=buildSubmittedDangerAtomicPlan({
      kind:"force-release",eventId:"ev",
      selection:selection("force-release",rows,rows.map(x=>x.id)),
      updatedAt:200,
    });
    assert.equal(p.affectedSlotIds.length,20);
    assert.deepEqual(p.expectedMutationChanges,[20,1]);
    assert.equal(p.preMutationAssertions.length,2);
    assert.deepEqual(execute(db,p),[20,1]);
    for(const row of rows){
      const saved=getSlot(db,row.id);
      assert.equal(saved.status,"available");
      assert.equal(saved.reserved_by_user_id,null);
      assert.equal(saved.video_id,null);
      assert.equal(saved.reservation_group_id,null);
      assert.equal(saved.slot_label,"Keep");
      assert.equal(saved.version,2);
    }
    assert.equal(getVideo(db).scheduling_type,"manual");
    assert.equal(getVideo(db).updated_at,200);
  }finally{db.close();}
});

test("SA-057: keep reservation, clear video only, conditional manual schedule",()=>{
  const rows=[slot("a"),slot("b")];
  const {db}=fixture(rows);
  try{
    const p=buildSubmittedDangerAtomicPlan({
      kind:"keep-reservation",eventId:"ev",
      selection:selection("keep-reservation",rows,["a","b"]),
      updatedAt:250,
    });
    assert.deepEqual(execute(db,p),[2,1]);
    for(const row of rows){
      const actual=getSlot(db,row.id);
      assert.equal(actual.status,"reserved");
      assert.equal(actual.reserved_by_user_id,"owner");
      assert.equal(actual.x_user_id,"x");
      assert.equal(actual.reservation_group_id," raw  ");
      assert.equal(actual.video_id,null);
      assert.equal(actual.version,2);
    }
    assert.equal(getVideo(db).scheduling_type,"manual");
  }finally{db.close();}
});

test("SA-056/057: an unrelated submitted reference preserves scheduling and is not updated",()=>{
  const rows=[slot("a"),slot("b")];
  const extra=slot("outside",{reservation_group_id:"other"});
  for(const kind of ["force-release","keep-reservation"]){
    const {db}=fixture([...rows,extra]);
    try{
      const p=buildSubmittedDangerAtomicPlan({
        kind,eventId:"ev",
        selection:selection(kind,rows,["a","b","outside"]),
        updatedAt:250,
      });
      assert.deepEqual(p.expectedMutationChanges,[2]);
      assert.deepEqual(execute(db,p),[2]);
      assert.equal(getSlot(db,"outside").status,"submitted");
      assert.equal(getVideo(db).scheduling_type,"slotted");
    }finally{db.close();}
  }
});

test("SA-056/057: raw-group phantom after read aborts ALL mutations",()=>{
  const rows=[slot("a"),slot("b")];
  for(const kind of ["force-release","keep-reservation"]){
    const {db,add}=fixture(rows);
    try{
      const p=buildSubmittedDangerAtomicPlan({
        kind,eventId:"ev",selection:selection(kind,rows,["a","b"]),updatedAt:250,
      });
      add(slot("phantom",{status:"reserved"}));
      assert.throws(()=>execute(db,p),/malformed JSON/i);
      assert.equal(getSlot(db,"a").status,"submitted");
      assert.equal(getSlot(db,"b").status,"submitted");
      assert.equal(getVideo(db).scheduling_type,"slotted");
    }finally{db.close();}
  }
});

test("SA-056/057: stale status, full slot field, version and video snapshot fail closed",()=>{
  const rows=[slot("a"),slot("b")];
  for(const [column,value] of [
    ["status","reserved"],["slot_label","Changed"],["version",2],
    ["updated_at",201],["reserved_by_user_id","else"],
    ["reservation_group_id","else"],["video_id","other"],
  ]){
    const {db}=fixture(rows);
    try{
      const p=buildSubmittedDangerAtomicPlan({
        kind:"force-release",eventId:"ev",
        selection:selection("force-release",rows,["a","b"]),
        updatedAt:250,
      });
      db.prepare("UPDATE slots SET "+column+"=? WHERE id='b'").run(value);
      assert.throws(()=>execute(db,p),/malformed JSON/i,column);
      assert.equal(getSlot(db,"a").status,"submitted",column);
    }finally{db.close();}
  }
  const {db}=fixture(rows);
  try{
    const p=buildSubmittedDangerAtomicPlan({
      kind:"keep-reservation",eventId:"ev",
      selection:selection("keep-reservation",rows,["a","b"]),
      updatedAt:250,
    });
    db.prepare("UPDATE videos SET updated_at=updated_at+1 WHERE id='vid'").run();
    assert.throws(()=>execute(db,p),/malformed JSON/i);
    assert.equal(getSlot(db,"a").status,"submitted");
  }finally{db.close();}
});

test("SA-056/057: concurrent submitted video ref insertion or removal aborts",()=>{
  const rows=[slot("a"),slot("b")];
  for(const mode of ["insert","remove"]){
    const {db,add}=fixture(rows);
    try{
      const p=buildSubmittedDangerAtomicPlan({
        kind:"force-release",eventId:"ev",
        selection:selection("force-release",rows,["a","b"]),
        updatedAt:250,
      });
      if(mode==="insert")add(slot("ref",{reservation_group_id:"other"}));
      else db.prepare("UPDATE slots SET status='reserved' WHERE id='b'").run();
      assert.throws(()=>execute(db,p),/malformed JSON/i);
      assert.equal(getSlot(db,"a").status,"submitted");
      assert.equal(getVideo(db).scheduling_type,"slotted");
    }finally{db.close();}
  }
});

test("SA-056/057: Unicode blank solo and legacy nullable video scheduling",()=>{
  const solo=slot("solo",{reservation_group_id:"\u3000"});
  const sibling=slot("sibling",{reservation_group_id:"\u3000",status:"reserved"});
  const {db}=fixture([solo,sibling],video({scheduling_type:null}));
  try{
    const p=buildSubmittedDangerAtomicPlan({
      kind:"force-release",eventId:"ev",
      selection:selection("force-release",[solo],["solo"],video({scheduling_type:null})),
      updatedAt:250,
    });
    assert.deepEqual(p.expectedMutationChanges,[1]);
    assert.deepEqual(execute(db,p),[1]);
    assert.equal(getSlot(db,"solo").status,"available");
    assert.equal(getSlot(db,"sibling").status,"reserved");
    assert.equal(getVideo(db).scheduling_type,null);
  }finally{db.close();}
});

test("SA-056: owner-less solo without video leaves no video audit or mutation",()=>{
  const solo=slot("solo",{reservation_group_id:null,video_id:null,reserved_by_user_id:null});
  const {db}=fixture([solo],null);
  try{
    const p=buildSubmittedDangerAtomicPlan({
      kind:"force-release",eventId:"ev",
      selection:selection("force-release",[solo],[],null),
      updatedAt:250,
    });
    assert.equal(p.preMutationAssertions.length,1);
    assert.deepEqual(execute(db,p),[1]);
    assert.equal(getSlot(db,"solo").status,"available");
  }finally{db.close();}
});

test("SA-056/057: strict audit failure simulations roll back both slot and video DML",()=>{
  const rows=[slot("a"),slot("b")],{db}=fixture(rows);
  try{
    const p=buildSubmittedDangerAtomicPlan({
      kind:"force-release",eventId:"ev",
      selection:selection("force-release",rows,["a","b"]),
      updatedAt:250,
    });
    assert.throws(()=>execute(db,p,{failAudit:true}),/simulated_strict_audit_failure/);
    assert.equal(getSlot(db,"a").status,"submitted");
    assert.equal(getSlot(db,"b").status,"submitted");
    assert.equal(getVideo(db).scheduling_type,"slotted");
  }finally{db.close();}
});

test("SA-056/057: malformed selection rejects before SQL and candidate is unmounted",async()=>{
  const rows=[slot("a"),slot("b")];
  const good=selection("force-release",rows,["a","b"]);
  for(const input of [
    {kind:"force-release",eventId:"ev",selection:{ok:false,message:"denied"},updatedAt:250},
    {kind:"force-release",eventId:" ev ",selection:good,updatedAt:250},
    {kind:"force-release",eventId:"ev",selection:good,updatedAt:NaN},
    {kind:"force-release",eventId:"ev",selection:{...good,submittedVideoRefIds:["a"]},updatedAt:250},
    {kind:"force-release",eventId:"ev",selection:{...good,submittedVideoRefIds:["a","a"]},updatedAt:250},
    {kind:"force-release",eventId:"ev",selection:{...good,rows:[rows[0],rows[0]]},updatedAt:250},
    {kind:"force-release",eventId:"ev",selection:{...good,rows:[{...rows[0],status:"available"},rows[1]]},updatedAt:250},
    {kind:"force-release",eventId:"ev",selection:{...good,shouldDetachVideoSchedulingAtRead:false},updatedAt:250},
    {kind:"force-release",eventId:"ev",selection:{...good,groupId:"other"},updatedAt:250},
  ]) assert.throws(()=>buildSubmittedDangerAtomicPlan(input));
  const p=buildSubmittedDangerAtomicPlan({
    kind:"force-release",eventId:"ev",selection:good,updatedAt:250,
  });
  assert.deepEqual(p.preMutationAssertions.map(x=>q(x).params.length),[5,8]);
  assert.ok(p.mutationStatements.every(x=>q(x).params.length<=5));
  const index=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotSubmittedDangerMutation|slotSubmittedDangerRoutes/);
});

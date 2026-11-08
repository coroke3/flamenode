// MIG-0656 U03b: SA-056/057 bounded D1 reader, post-authorization decoder.
// No Hono route, remote D1, audit or Queue side effects.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import {
  SLOT_SUBMITTED_DANGER_ANCHOR_SQL,
  SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL,
  SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL,
  selectAuthorizedSubmittedDangerAnchor,
  needsSubmittedDangerGroupRead,
  submittedDangerVideoReadId,
  decodeSubmittedDangerReads,
} from "../src/routes/manage/slotSubmittedDangerSnapshot.ts";
const cols=[
  "id","event_id","reserved_by_user_id","x_user_id",
  "reserved_x_id_snapshot","display_name","slot_label","start_time",
  "sort_order","reservation_group_id","video_id","status","updated_at","version",
];
const slot=(id,patch={})=>({
  id,event_id:"ev",reserved_by_user_id:"owner",x_user_id:"x1",
  reserved_x_id_snapshot:"x1",display_name:"Person",slot_label:"Keep",
  start_time:null,sort_order:0,reservation_group_id:"raw  ",
  video_id:"vid",status:"submitted",updated_at:100,version:3,...patch,
});
function setup(rows=[slot("s0"),slot("s1")], options={}){
  const db=new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE events (id TEXT PRIMARY KEY);",
    "INSERT INTO events VALUES('ev');",
    "CREATE TABLE event_staff(event_id TEXT,x_user_id TEXT,permission_preset TEXT,custom_permission_keys_json TEXT);",
    "CREATE TABLE x_user_account_links(auth_user_id TEXT,x_user_id TEXT);",
    "CREATE TABLE x_users(id TEXT PRIMARY KEY,approval_status TEXT);",
    "INSERT INTO x_users VALUES('x1','approved');",
    "INSERT INTO x_user_account_links VALUES('staff','x1');",
    "INSERT INTO event_staff VALUES('ev','x1','slot_manager',NULL);",
    "CREATE TABLE videos(id TEXT PRIMARY KEY,scheduling_type TEXT,updated_at INTEGER);",
    "CREATE TABLE slots(" + cols.map(k=>k==="id"?"id TEXT PRIMARY KEY":
      ["start_time","sort_order","updated_at","version"].includes(k)
        ?k+" INTEGER":k+" TEXT").join(",") + ");",
  ].join(" "));
  db.prepare("INSERT INTO videos VALUES(?,?,?)").run("vid",options.schedulingType??"slotted",400);
  const insert=db.prepare("INSERT INTO slots VALUES("+cols.map(()=>"?").join(",")+")");
  for(const row of rows)insert.run(...cols.map(k=>row[k]));
  return db;
}
function read(db,{slotId="s0",eventId="ev",actorId="staff",role="user",kind="keep-reservation"}={}){
  const a=db.prepare(SLOT_SUBMITTED_DANGER_ANCHOR_SQL)
    .get(eventId,eventId,actorId,eventId,slotId);
  const authorized=selectAuthorizedSubmittedDangerAnchor({
    eventId,slotId,actorRole:role,read:a,
  });
  if(!authorized.ok)return {authorized,selection:null,reads:1};
  const anchor=authorized.anchor;
  const groupRead=needsSubmittedDangerGroupRead(anchor)
    ?db.prepare(SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL)
      .get(eventId,anchor.reservation_group_id):null;
  const videoId=submittedDangerVideoReadId(anchor);
  const videoRead=videoId
    ?db.prepare(SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL).get(videoId,videoId):null;
  const selection=decodeSubmittedDangerReads({
    kind,eventId,slotId,authorized,groupRead,videoRead,
  });
  return {authorized,selection,reads:1+Number(groupRead!==null)+Number(videoRead!==null)};
}
test("SA-056/057: three bound SELECTs give complete raw 20-member group and video references",()=>{
  const db=setup(Array.from({length:20},(_,i)=>slot("s"+i)));
  try{
    for(const kind of ["force-release","keep-reservation"]){
      const result=read(db,{kind});
      assert.equal(result.authorized.ok,true);
      assert.equal(result.reads,3);
      assert.equal(result.selection.ok,true,JSON.stringify(result.selection));
      assert.equal(result.selection.rows.length,20);
      assert.equal(result.selection.groupId,"raw");
      assert.equal(result.selection.videoId,"vid");
      assert.equal(result.selection.shouldDetachVideoSchedulingAtRead,true);
    }
  }finally{db.close();}
});
test("SA-056/057: a 21st raw group member prevents partial 20-member release",()=>{
  const db=setup(Array.from({length:21},(_,i)=>slot("s"+i)));
  try{
    assert.equal(read(db).selection.ok,false);
    assert.equal(read(db,{kind:"force-release"}).selection.ok,false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM slots").get().n,21);
  }finally{db.close();}
});
test("SA-056/057: 21st submitted video reference prevents inaccurate detach decision",()=>{
  const db=setup([
    slot("s0"),slot("s1"),
    ...Array.from({length:19},(_,i)=>slot("other-"+i,{
      reservation_group_id:"other",
    })),
  ]);
  try{
    assert.equal(read(db).selection.ok,false);
    assert.equal(read(db,{kind:"force-release"}).selection.ok,false);
  }finally{db.close();}
});
test("SA-056/057: authorize before existence; denied staff cannot inspect missing or existing slot",()=>{
  const db=setup();
  try{
    for(const eventId of ["ev","missing"]){
      const result=read(db,{eventId,actorId:"unlinked",role:"user"});
      assert.deepEqual(result.authorized,{ok:false,message:"Not Found"});
      assert.equal(result.selection,null);
      assert.equal(result.reads,1);
    }
    const allowed=read(db,{role:"admin",actorId:"unlinked"});
    assert.equal(allowed.selection.ok,true);
    const bad=db.prepare(SLOT_SUBMITTED_DANGER_ANCHOR_SQL)
      .get("ev","ev","unlinked","ev","s0");
    assert.deepEqual(selectAuthorizedSubmittedDangerAnchor({
      eventId:"ev",slotId:"s0",actorRole:"user",
      read:{...bad,anchor_json:"{broken JSON"},
    }),{ok:false,message:"Not Found"});
  }finally{db.close();}
});
test("SA-056/057: raw group whitespace and Unicode-JS-blank remain isolated",()=>{
  const db=setup([
    slot("s0",{reservation_group_id:"g  "}),
    slot("s1",{reservation_group_id:"g  "}),
    slot("other",{reservation_group_id:"g"}),
    slot("solo",{reservation_group_id:"\u3000",video_id:null}),
    slot("same-raw-blank",{reservation_group_id:"\u3000",video_id:null}),
  ]);
  try{
    const selected=read(db);
    assert.equal(selected.selection.ok,true,JSON.stringify(selected.selection));
    assert.deepEqual(selected.selection.rows.map(row=>row.id).sort(),["s0","s1"]);
    const solo=read(db,{slotId:"solo",kind:"force-release"});
    assert.equal(solo.selection.ok,true,JSON.stringify(solo.selection));
    assert.equal(solo.selection.rows.length,1);
    assert.equal(solo.reads,1);
    const forbiddenKeep=read(db,{slotId:"solo",kind:"keep-reservation"});
    assert.equal(forbiddenKeep.selection.ok,false);
    assert.equal(forbiddenKeep.reads,1);
  }finally{db.close();}
});
test("SA-056/057: video other submitted refs preserve scheduling while keeping read count bound",()=>{
  const db=setup([slot("s0"),slot("s1"),slot("unrelated",{reservation_group_id:"other"})]);
  try{
    const output=read(db);
    assert.equal(output.selection.ok,true);
    assert.equal(output.selection.shouldDetachVideoSchedulingAtRead,false);
    assert.equal(output.reads,3);
  }finally{db.close();}
});
test("SA-056/057: malformed JSON, missing video and stale group references fail closed",()=>{
  const db=setup();
  try{
    const a=db.prepare(SLOT_SUBMITTED_DANGER_ANCHOR_SQL)
      .get("ev","ev","staff","ev","s0");
    const authorized=selectAuthorizedSubmittedDangerAnchor({
      eventId:"ev",slotId:"s0",actorRole:"user",read:a,
    });
    assert.equal(authorized.ok,true);
    const group=db.prepare(SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL).get("ev","raw  ");
    const video=db.prepare(SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL).get("vid","vid");
    for(const mutation of [
      {groupRead:{group_json:"broken"},videoRead:video},
      {groupRead:{group_json:JSON.stringify([slot("other")])},videoRead:video},
      {groupRead:group,videoRead:{video_json:"{invalid",refs_json:video.refs_json}},
      {groupRead:group,videoRead:{video_json:video.video_json,refs_json:"bad"}},
      {groupRead:group,videoRead:{video_json:video.video_json,refs_json:JSON.stringify([{id:"s0"}])}},
      {groupRead:group,videoRead:{video_json:null,refs_json:video.refs_json}},
    ]){
      const selection=decodeSubmittedDangerReads({
        kind:"keep-reservation",eventId:"ev",slotId:"s0",
        authorized,...mutation,
      });
      assert.equal(selection.ok,false,JSON.stringify(mutation).slice(0,100));
    }
    assert.equal(submittedDangerVideoReadId({
      ...authorized.anchor,video_id:"\u3000",
    }),null);
    assert.equal(submittedDangerVideoReadId({
      ...authorized.anchor,video_id:" vid ",
    }),"vid");
  }finally{db.close();}
});
test("SA-056/057: only three read-only bounded SQL statements and never mounted",async()=>{
  const clauses=[
    [SLOT_SUBMITTED_DANGER_ANCHOR_SQL,5],
    [SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL,2],
    [SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL,2],
  ];
  for(const [sql,binds] of clauses){
    assert.match(sql,/^SELECT\b/);
    assert.equal((sql.match(/\?/g)||[]).length,binds);
    assert.doesNotMatch(sql,/\b(UPDATE|DELETE|INSERT)\b/i);
  }
  assert.match(SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL,/LIMIT 21/);
  assert.match(SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL,/LIMIT 21/);
  const index=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotSubmittedDangerSnapshot|slotSubmittedDangerRoutes/);
});

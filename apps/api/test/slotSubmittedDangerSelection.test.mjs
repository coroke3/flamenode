// MIG-0656 U03a: SA-056/057 offline submitted danger selection, UNMOUNTED.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  selectSubmittedDangerSnapshot,
} from "../src/routes/manage/slotSubmittedDangerSelection.ts";

const video = { id:"v1", scheduling_type:"slotted", updated_at:400 };
const slot=(id,patch={})=>({
  id,event_id:"ev",reserved_by_user_id:"u1",x_user_id:"x1",
  reserved_x_id_snapshot:"x1",display_name:"Person",slot_label:"Keep",
  start_time:null,sort_order:1,reservation_group_id:"raw  ",
  video_id:"v1",status:"submitted",updated_at:100,version:1,...patch,
});
function input(kind="keep-reservation",rows=[slot("a"),slot("b")]){
  return {kind,eventId:"ev",slotId:rows[0].id,anchor:rows[0],
    groupedRows:rows,videoBefore:video,
    submittedVideoRefs:rows.map(row=>({id:row.id}))};
}
const select=updates=>selectSubmittedDangerSnapshot({...input(),...updates});

test("SA-056: force release can select a complete 20-row raw group",()=>{
  const rows=Array.from({length:20},(_,i)=>slot("id-"+i));
  const result=selectSubmittedDangerSnapshot(input("force-release",rows));
  assert.equal(result.ok,true);
  if(!result.ok)throw Error("expected selection");
  assert.equal(result.rows.length,20);
  assert.equal(result.groupId,"raw");
  assert.equal(result.videoId,"v1");
  assert.equal(result.shouldDetachVideoSchedulingAtRead,true);
  assert.equal(result.rows[0].reservation_group_id,"raw  ");
});

test("SA-057: keeping reservation selects same raw group with valid subject",()=>{
  const result=select({});
  assert.equal(result.ok,true);
  if(!result.ok)throw Error("expected selection");
  assert.equal(result.rows.length,2);
  assert.equal(result.videoBefore.id,"v1");
  assert.equal(result.shouldDetachVideoSchedulingAtRead,true);
});

test("SA-056/057: 21 members, anchor omission, duplicate, raw group mismatch rejected",()=>{
  const rows=Array.from({length:21},(_,i)=>slot("id-"+i));
  assert.equal(selectSubmittedDangerSnapshot(input("force-release",rows)).ok,false);
  assert.equal(select({groupedRows:[slot("b")]}).ok,false);
  assert.equal(select({groupedRows:[slot("a"),slot("a")]}).ok,false);
  assert.equal(select({groupedRows:[slot("a"),slot("b",{reservation_group_id:"raw"})]}).ok,false);
  assert.equal(select({anchor:null}).ok,false);
  assert.equal(select({slotId:"not-a"}).ok,false);
});

test("SA-057: mixed reservation fields, changed video, non-submitted and missing owner reject",()=>{
  for(const patch of [
    {reserved_by_user_id:"u2"}, {x_user_id:"x2"},
    {reserved_x_id_snapshot:"x2"},{display_name:"Other"},
    {video_id:"v2"},{status:"reserved"},{event_id:"other"},
    {updated_at:NaN},{version:1.5},
  ]) assert.equal(select({groupedRows:[slot("a"),slot("b",patch)]}).ok,false,JSON.stringify(patch));
  const absent=slot("a",{reserved_by_user_id:null});
  assert.equal(selectSubmittedDangerSnapshot(input("keep-reservation",[absent])).ok,false);
});

test("SA-056/057: submitted video missing is invalid for keep but allowed in legacy force",()=>{
  const solo=slot("a",{reservation_group_id:null,video_id:null});
  const dangerous=selectSubmittedDangerSnapshot({
    ...input("force-release",[solo]),videoBefore:null,submittedVideoRefs:[],
  });
  assert.equal(dangerous.ok,true);
  if(!dangerous.ok)throw Error("expected force-release selection");
  assert.equal(dangerous.videoId,null);
  assert.equal(dangerous.shouldDetachVideoSchedulingAtRead,false);
  assert.equal(selectSubmittedDangerSnapshot({
    ...input("keep-reservation",[solo]),videoBefore:null,submittedVideoRefs:[],
  }).ok,false);
});

test("SA-056/057: other submitted video references preserve video scheduling",()=>{
  const result=select({submittedVideoRefs:[{id:"a"},{id:"b"},{id:"other"}]});
  assert.equal(result.ok,true);
  if(!result.ok)throw Error("expected selection");
  assert.equal(result.shouldDetachVideoSchedulingAtRead,false);
  const manual=select({videoBefore:{...video,scheduling_type:"manual"}});
  assert.equal(manual.ok,true);
  if(!manual.ok)throw Error("expected selection");
  assert.equal(manual.shouldDetachVideoSchedulingAtRead,false);
});

test("SA-056/057: ref overflow, incomplete reference set and missing video fail closed",()=>{
  const refs=Array.from({length:21},(_,i)=>({id:"ref-"+i}));
  assert.equal(select({submittedVideoRefs:refs}).ok,false);
  assert.equal(select({submittedVideoRefs:[{id:"a"}]}).ok,false);
  assert.equal(select({submittedVideoRefs:[{id:"a"},{id:"a"}]}).ok,false);
  assert.equal(select({videoBefore:null}).ok,false);
  assert.equal(select({videoBefore:{...video,id:"wrong"}}).ok,false);
});

test("SA-056/057: Unicode whitespace raw group must be treated as solo",()=>{
  const anchor=slot("a",{reservation_group_id:"\u3000"});
  for(const kind of ["force-release","keep-reservation"]){
    const result=selectSubmittedDangerSnapshot({
      ...input(kind,[anchor]),groupedRows:[anchor,slot("b",{reservation_group_id:"\u3000"})],
      submittedVideoRefs:[{id:"a"}],
    });
    assert.equal(result.ok,true);
    if(result.ok){
      assert.equal(result.rows.length,1);
      assert.equal(result.groupId,null);
    }
  }
});

test("SA-056/057: expected event, legal kind and snapshot shape, no route mount",async()=>{
  assert.equal(select({kind:"unknown"}).ok,false);
  assert.equal(select({eventId:"other"}).ok,false);
  assert.equal(select({eventId:" ev "}).ok,false);
  assert.equal(select({slotId:" a "}).ok,false);
  assert.equal(select({anchor:slot("a",{slot_label:42})}).ok,false);
  const index=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotSubmittedDangerSelection|slotSubmittedDangerRoutes/);
});

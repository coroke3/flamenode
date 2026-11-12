// MIG-0656 U03d: SA-056/057 complete videos schema and strict audit parity.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SUBMITTED_VIDEO_AUDIT_COLUMNS,
  SUBMITTED_VIDEO_AUDIT_JSON_FIELDS,
  parseSubmittedVideoAuditBefore,
} from "../src/routes/manage/slotSubmittedVideoAudit.ts";
import { selectSubmittedDangerSnapshot } from "../src/routes/manage/slotSubmittedDangerSelection.ts";
import { buildSubmittedDangerAtomicPlan } from "../src/routes/manage/slotSubmittedDangerMutation.ts";
import { buildSubmittedDangerStrictAudits } from "../src/routes/manage/slotSubmittedDangerAudit.ts";

const video = (changes={}) => ({
  id:"v1",primary_event_id:"ev",creator_x_user_id:"x1",
  submitted_by_user_id:"owner",collaboration_type:"collab",
  part:"Part 1",source_type:"external",creator_display_name:"Person",
  creator_display_name_yomi:"パーソン",creator_icon_url:"https://example.org/icon",
  creator_youtube_channel_url:null,creator_profile_text:"Very long description",
  creator_other_social_links:"[]",title:"Original work",music:"BGM",
  credit:"Thank you",music_reference_url:null,closing_comment:"End",
  youtube_video_id:"video-001",intro_comment:"Hello",highlights:"Highlight",
  production_story:null,visibility_status:"pending",
  scheduling_type:"slotted",scheduled_time:300,app_like_count:41,
  score:2.75,score_updated_at:250,created_at:100,updated_at:400,
  ...changes,
});
const slot=(id,patch={})=>({
  id,event_id:"ev",reserved_by_user_id:"owner",x_user_id:"x1",
  reserved_x_id_snapshot:"x1",display_name:"Person",slot_label:"Title",
  start_time:null,sort_order:0,reservation_group_id:"group  ",
  video_id:"v1",status:"submitted",updated_at:200,version:3,...patch,
});
function prepare(kind,rows,refs,opts={}){
  const before=opts.video??video();
  const sel=selectSubmittedDangerSnapshot({
    kind,eventId:"ev",slotId:rows[0].id,anchor:rows[0],
    groupedRows:rows,videoBefore:before,
    videoAuditBefore:opts.auditVideo===undefined?before:opts.auditVideo,
    submittedVideoRefs:refs.map(id=>({id})),
  });
  assert.equal(sel.ok,true,JSON.stringify(sel));
  const plan=buildSubmittedDangerAtomicPlan({
    kind,eventId:"ev",selection:sel,updatedAt:500,
  });
  return {sel,plan};
}
test("SA-056/057 canonical videos snapshot preserves exactly all 30 fields",()=>{
  const fields=new Set(SUBMITTED_VIDEO_AUDIT_COLUMNS);
  assert.equal(fields.size,30);
  assert.equal(Object.keys(video()).length,30);
  assert.deepEqual(new Set(Object.keys(video())),fields);
  const parsed=parseSubmittedVideoAuditBefore(video());
  assert.ok(parsed);
  assert.equal(parsed.title,"Original work");
  assert.equal(parsed.score,2.75);
  assert.equal(parsed.scheduled_time,300);
  assert.ok(SUBMITTED_VIDEO_AUDIT_JSON_FIELDS.includes("'music', v.\"music\""));
  assert.ok(SUBMITTED_VIDEO_AUDIT_JSON_FIELDS.includes("'updated_at', v.\"updated_at\""));
  assert.ok(parseSubmittedVideoAuditBefore(video({scheduling_type:null})));
  assert.ok(parseSubmittedVideoAuditBefore(video({score:0,scheduled_time:null})));
});
test("SA-056/057 missing, extra, malformed or wrong-typed video before images are rejected",()=>{
  for(const candidate of [
    null,[],{},Object.fromEntries(Object.entries(video()).filter(([k])=>k!=="music")),
    {...video(),unknown:"unexpected"},{...video(),title:null},
    {...video(),score:"3"},{...video(),score:Infinity},
    {...video(),created_at:1.5},{...video(),scheduling_type:42},
    {...video(),scheduled_time:"later"},{...video(),app_like_count:null},
  ])assert.equal(parseSubmittedVideoAuditBefore(candidate),null);
});
test("SA-056 strict audits cover all 20 slots + full video before/after without deleting video",()=>{
  const rows=Array.from({length:20},(_,i)=>slot("s"+i,{sort_order:i}));
  const {sel,plan}=prepare("force-release",rows,rows.map(row=>row.id));
  const audits=buildSubmittedDangerStrictAudits({
    kind:"force-release",selection:sel,plan,actorUserId:"admin",updatedAt:500,
  });
  assert.equal(audits.length,21);
  assert.ok(audits.every(a=>a.operation==="UPDATE"&&a.strict===true&&a.retention_class==="long_audit"));
  for(const audit of audits.slice(0,20)){
    assert.equal(audit.table_name,"slots");
    assert.equal(Object.keys(audit.before).length,14);
    assert.equal(audit.before.status,"submitted");
    assert.equal(audit.after.status,"available");
    assert.equal(audit.after.reserved_by_user_id,null);
    assert.equal(audit.after.video_id,null);
    assert.equal(audit.after.version,4);
    assert.equal(audit.after.slot_label,"Title");
  }
  const v=audits[20];
  assert.equal(v.table_name,"videos");
  assert.equal(Object.keys(v.before).length,30);
  assert.equal(Object.keys(v.after).length,30);
  assert.equal(v.before.title,"Original work");
  assert.equal(v.before.creator_profile_text,"Very long description");
  assert.equal(v.before.updated_at,400);
  assert.equal(v.after.scheduling_type,"manual");
  assert.equal(v.after.updated_at,500);
  for(const key of SUBMITTED_VIDEO_AUDIT_COLUMNS){
    if(key!=="updated_at"&&key!=="scheduling_type"){
      assert.deepEqual(v.before[key],v.after[key],key);
    }
  }
});
test("SA-057 strict audits retain reservation; unrelated submitted video reference avoids video UPDATE",()=>{
  const rows=[slot("a"),slot("b")];
  const {sel,plan}=prepare("keep-reservation",rows,["a","b","other"]);
  const audits=buildSubmittedDangerStrictAudits({
    kind:"keep-reservation",selection:sel,plan,actorUserId:"admin",updatedAt:500,
  });
  assert.equal(audits.length,2);
  for(const a of audits){
    assert.equal(a.table_name,"slots");
    assert.equal(a.before.status,"submitted");
    assert.equal(a.after.status,"reserved");
    assert.equal(a.after.reserved_by_user_id,"owner");
    assert.equal(a.after.x_user_id,"x1");
    assert.equal(a.after.reservation_group_id,"group  ");
    assert.equal(a.after.video_id,null);
    assert.equal(a.after.version,4);
  }
});
test("SA-056/057 detached video requires FULL before-image; minimal 3-column summary cannot create strict audit",()=>{
  const rows=[slot("a"),slot("b")];
  const {sel,plan}=prepare("keep-reservation",rows,["a","b"],{auditVideo:null});
  assert.throws(()=>buildSubmittedDangerStrictAudits({
    kind:"keep-reservation",selection:sel,plan,actorUserId:"admin",updatedAt:500,
  }),/missing_complete_video_before/);
});
test("SA-056 owner-less, no-video solo builds one strict slot audit, no video audit",()=>{
  const row=slot("solo",{reservation_group_id:null,video_id:null,reserved_by_user_id:null});
  const sel=selectSubmittedDangerSnapshot({
    kind:"force-release",eventId:"ev",slotId:"solo",anchor:row,
    groupedRows:[],videoBefore:null,submittedVideoRefs:[],
  });
  assert.equal(sel.ok,true);
  const plan=buildSubmittedDangerAtomicPlan({kind:"force-release",eventId:"ev",selection:sel,updatedAt:500});
  const audits=buildSubmittedDangerStrictAudits({
    kind:"force-release",selection:sel,plan,actorUserId:"admin",updatedAt:500,
  });
  assert.equal(audits.length,1);
  assert.equal(audits[0].after.video_id,null);
  assert.equal(audits[0].after.status,"available");
});
test("SA-056/057 invalid actor, mismatched plan, timestamp and bad selection fail before audit",()=>{
  const rows=[slot("a")];
  const {sel,plan}=prepare("force-release",rows,["a"]);
  const inputs=[
    {actorUserId:"",updatedAt:500,selection:sel,plan},
    {actorUserId:" admin ",updatedAt:500,selection:sel,plan},
    {actorUserId:"admin",updatedAt:NaN,selection:sel,plan},
    {actorUserId:"admin",updatedAt:500,selection:{ok:false,message:"no"},plan},
    {actorUserId:"admin",updatedAt:500,selection:sel,plan:{...plan,affectedSlotIds:["different"]}},
    {actorUserId:"admin",updatedAt:500,selection:sel,plan:{...plan,updatesVideoScheduling:false}},
  ];
  for(const inp of inputs)assert.throws(()=>buildSubmittedDangerStrictAudits({
    kind:"force-release",...inp,
  }),undefined,JSON.stringify(inp).slice(0,140));
});
test("SA-056/057 complete-audit helper never mounts a Hono route",async()=>{
  const index=await readFile(new URL("../src/routes/manage/index.ts",import.meta.url),"utf8");
  assert.doesNotMatch(index,/slotSubmittedVideoAudit|slotSubmittedDangerAudit/);
});

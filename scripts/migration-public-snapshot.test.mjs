import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
 loadPublicBuildSnapshot, newSnapshotBuildMetrics, SnapshotBuildError
} from "../apps/site/src/lib/publicDataLoader.ts";

const key="snapshot/video/public_demo.json";
const generation="fixture-generation-01";
const data={kind:"video",id:"public_demo",title:"Synthetic public video",privateEmail:"never-export"};
const sha256=payload=>createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const pack=(payload=data,overrides={})=>Buffer.from(JSON.stringify({
 schemaVersion:1,generation,key,visibility:"public",payload,sha256:sha256(payload),...overrides
}));
const manifest=(overrides={})=>({schemaVersion:1,generation,allowedKeys:[key],blockedKeys:[],...overrides});
const options=(m=manifest(),metrics=newSnapshotBuildMetrics())=>({generation,manifest:m,metrics});
const source=(bytes)=>({read:async()=>bytes});
async function rejects(bytes,code,opts=options()){
 await assert.rejects(()=>loadPublicBuildSnapshot(source(bytes),key,opts),
  e=>e instanceof SnapshotBuildError&&e.code===code,`expected ${code}`);
}
test("valid public projection accepts bounded DTO only and measures work",async()=>{
 const metrics=newSnapshotBuildMetrics(),snapshot=await loadPublicBuildSnapshot(source(pack()),key,options(manifest(),metrics));
 assert.deepEqual(snapshot,{kind:"video",id:"public_demo",title:"Synthetic public video"});
 assert.equal(metrics.reads,1);assert.equal(metrics.accepted,1);assert.equal(metrics.rejected,0);
 assert.ok(metrics.bytes>0);assert.ok(metrics.parseMs>=0);
 assert.doesNotMatch(JSON.stringify(snapshot),/never-export|privateEmail/);
});
test("manifest unavailable, blocked and missing allowlist fail before source read",async()=>{
 let reads=0;
 const s={read:async()=>{reads++;return pack();}};
 for(const m of [null,manifest({generation:"stale"}),manifest({blockedKeys:[key]}),manifest({allowedKeys:[]})]){
  await assert.rejects(()=>loadPublicBuildSnapshot(s,key,options(m)),SnapshotBuildError);
 }
 assert.equal(reads,0);
});
test("private envelope is rejected even if manifest is stale allow",async()=>rejects(pack(data,{visibility:"private"}),"NOT_PUBLIC"));
test("generation mismatch fails closed",async()=>rejects(pack(data,{generation:"old"}),"GENERATION_MISMATCH"));
test("missing and corrupt objects fail closed",async()=>{
 await rejects(null,"SNAPSHOT_MISSING");await rejects(Buffer.from("{"),"INVALID_JSON");
 await rejects(pack(data,{sha256:"a".repeat(64)}),"HASH_MISMATCH");
});
test("oversized fixture is rejected before JSON parse",async()=>{
 await rejects(pack(),"INVALID_SIZE",{...options(),maxBytes:3});
});
test("wrong key, entity identity and malformed data are rejected",async()=>{
 await rejects(pack(data,{key:"snapshot/video/other.json"}),"GENERATION_MISMATCH");
 await rejects(pack({...data,id:"private_other"}),"ENTITY_MISMATCH");
 await rejects(pack({...data,id:"../private"}),"INVALID_PAYLOAD");
});
test("source failures never allow implicit live D1 fallback",async()=>{
 await assert.rejects(()=>loadPublicBuildSnapshot({read:()=>Promise.reject(Error("R2 failed"))},key,options()),
  e=>e instanceof SnapshotBuildError&&e.code==="SOURCE_UNAVAILABLE");
});

// MIG-0403 U01: the representative-page fields are projected by allow list per kind.
const loadAs=async(payload)=>{
 const k=`snapshot/${payload.kind}/${payload.id}.json`;
 const bytes=Buffer.from(JSON.stringify({schemaVersion:1,generation,key:k,visibility:"public",payload,sha256:sha256(payload)}));
 return loadPublicBuildSnapshot(source(bytes),k,options(manifest({allowedKeys:[k]})));
};
test("MIG-0403 U01: video DTO keeps only the public page fields",async()=>{
 const snapshot=await loadAs({
  kind:"video",id:"public_demo",title:"Video 1",youtubeVideoId:"abcDEF12345",creatorName:"Creator",creatorXUserId:"creator_x",
  creatorIconUrl:"https://example.com/icon.png",creatorHasPublicProfile:true,creatorYoutubeChannelUrl:"https://www.youtube.com/@c",
  scheduledTime:1792238400,music:"Song",credit:"Artist",introComment:"Intro",highlights:"High",
  visibility_status:"private",privateEmail:"secret@example.com",internalFlags:{adminOnly:true},
 });
 assert.deepEqual(snapshot,{
  kind:"video",id:"public_demo",title:"Video 1",youtubeVideoId:"abcDEF12345",creatorName:"Creator",creatorXUserId:"creator_x",
  creatorIconUrl:"https://example.com/icon.png",creatorHasPublicProfile:true,creatorYoutubeChannelUrl:"https://www.youtube.com/@c",
  scheduledTime:1792238400,music:"Song",credit:"Artist",introComment:"Intro",highlights:"High",
 });
});
test("MIG-0403 U01: user and event DTOs keep only the public page fields",async()=>{
 assert.deepEqual(await loadAs({kind:"user",id:"user_demo",title:"Alice",name:"Alice",iconUrl:"/i.png",profileText:"Bio",
  youtubeChannelUrl:"https://www.youtube.com/@a",secretToken:"xyz",approval_status:"approved"}),
  {kind:"user",id:"user_demo",title:"Alice",name:"Alice",iconUrl:"/i.png",profileText:"Bio",youtubeChannelUrl:"https://www.youtube.com/@a"});
 assert.deepEqual(await loadAs({kind:"event",id:"event_demo",title:"Ev",explanation:"Ex",imageUrl:"https://e.com/b.jpg",iconUrl:"/i.png",
  statusLabel:"開始前",periodLabel:"2026/11/01 〜 11/30",entryAction:"reserve",internalBudget:100000}),
  {kind:"event",id:"event_demo",title:"Ev",explanation:"Ex",imageUrl:"https://e.com/b.jpg",iconUrl:"/i.png",
   statusLabel:"開始前",periodLabel:"2026/11/01 〜 11/30",entryAction:"reserve"});
});
test("MIG-0403 U01: fields of another kind are not projected",async()=>{
 const snapshot=await loadAs({kind:"user",id:"user_demo",title:"Alice",youtubeVideoId:"abcDEF12345",explanation:"x",creatorName:"y"});
 assert.deepEqual(snapshot,{kind:"user",id:"user_demo",title:"Alice"});
});
test("MIG-0403 U01: unsafe URLs, malformed IDs and wrong types are dropped",async()=>{
 const snapshot=await loadAs({
  kind:"video",id:"bad_url_video",title:"Bad",creatorIconUrl:"javascript:alert(1)",creatorYoutubeChannelUrl:"//evil.example/x",
  youtubeVideoId:"malicious<script>",creatorXUserId:"../admin",creatorHasPublicProfile:"yes",scheduledTime:"1792238400",
  music:"",introComment:42,
 });
 assert.deepEqual(snapshot,{kind:"video",id:"bad_url_video",title:"Bad"});
 const user=await loadAs({kind:"user",id:"u",title:"U",iconUrl:"data:text/html,<script>alert(1)</script>",youtubeChannelUrl:"/\\evil.example"});
 assert.deepEqual(user,{kind:"user",id:"u",title:"U"});
 const event=await loadAs({kind:"event",id:"e",title:"E",imageUrl:"vbscript:x",entryAction:"delete"});
 assert.deepEqual(event,{kind:"event",id:"e",title:"E"});
});
test("MIG-0403 U01: long text is clamped and an oversized title is rejected",async()=>{
 const snapshot=await loadAs({kind:"video",id:"v",title:"V",introComment:"a".repeat(6000),creatorName:"n".repeat(150)});
 assert.equal(snapshot.introComment.length,5000);assert.equal(snapshot.creatorName.length,100);
 await assert.rejects(()=>loadAs({kind:"user",id:"over_user",title:"A".repeat(301)}),e=>e instanceof SnapshotBuildError&&e.code==="INVALID_PAYLOAD");
});
test("F-06: CURRENT ids starting with `_` or `-` are accepted and creatorXUserId is kept",async()=>{
 assert.deepEqual(await loadAs({kind:"user",id:"_foo",title:"Foo"}),{kind:"user",id:"_foo",title:"Foo"});
 assert.deepEqual(await loadAs({kind:"user",id:"-foo",title:"Foo"}),{kind:"user",id:"-foo",title:"Foo"});
 assert.deepEqual(await loadAs({kind:"event",id:"-ev_01",title:"Ev"}),{kind:"event",id:"-ev_01",title:"Ev"});
 assert.deepEqual(await loadAs({kind:"video",id:"_v1",title:"V",creatorXUserId:"_foo",creatorHasPublicProfile:true}),
  {kind:"video",id:"_v1",title:"V",creatorXUserId:"_foo",creatorHasPublicProfile:true});
 assert.equal((await loadAs({kind:"video",id:"v1",title:"V",creatorXUserId:"Foo_Bar"})).creatorXUserId,"Foo_Bar");
});
test("F-06: unsafe or non-CURRENT ids are still rejected",async()=>{
 for(const id of ["","../private","a/b","a\\b","a.b",".","-".repeat(129),"a b"]){
  await assert.rejects(()=>loadPublicBuildSnapshot(source(pack({...data,id})),key,options()),
   e=>e instanceof SnapshotBuildError&&e.code==="INVALID_PAYLOAD",id);
 }
 for(const creatorXUserId of ["-foo","a".repeat(21),"../admin","a/b","a.b",""]){
  assert.equal((await loadAs({kind:"video",id:"v1",title:"V",creatorXUserId})).creatorXUserId,undefined,creatorXUserId);
 }
});

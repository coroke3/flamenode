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

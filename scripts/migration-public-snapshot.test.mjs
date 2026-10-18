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

test("MIG-0403 U01: video, user and event extended DTO strictly projects public attributes and drops private fields", async () => {
  const videoPayload = {
    kind: "video",
    id: "public_demo",
    title: "Video 1",
    description: "Sample video description",
    creatorName: "Creator Alpha",
    creatorHandle: "@alpha",
    thumbnailUrl: "https://example.com/thumb.jpg",
    publishedAt: "2026-10-18T00:00:00Z",
    youtubeVideoId: "yt123456789",
    privateEmail: "secret@example.com",
    internalFlags: { adminOnly: true },
  };
  const snapshot = await loadPublicBuildSnapshot(source(pack(videoPayload)), key, options());
  assert.equal(snapshot.creatorName, "Creator Alpha");
  assert.equal(snapshot.thumbnailUrl, "https://example.com/thumb.jpg");
  assert.equal(snapshot.youtubeVideoId, "yt123456789");
  assert.equal(snapshot.description, "Sample video description");
  assert.equal("privateEmail" in snapshot, false);
  assert.equal("internalFlags" in snapshot, false);

  // User snapshot
  const userKey = "snapshot/user/user_demo.json";
  const userPayload = {
    kind: "user",
    id: "user_demo",
    title: "Alice Profile",
    name: "Alice",
    handle: "@alice",
    bio: "User bio",
    avatarUrl: "https://example.com/alice.jpg",
    secretToken: "xyz",
  };
  const userBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, generation, key: userKey, visibility: "public",
    payload: userPayload, sha256: sha256(userPayload)
  }));
  const userOpts = options({ schemaVersion: 1, generation, allowedKeys: [userKey], blockedKeys: [] });
  const userSnapshot = await loadPublicBuildSnapshot(source(userBytes), userKey, userOpts);
  assert.equal(userSnapshot.kind, "user");
  assert.equal(userSnapshot.name, "Alice");
  assert.equal(userSnapshot.handle, "@alice");
  assert.equal(userSnapshot.bio, "User bio");
  assert.equal("secretToken" in userSnapshot, false);

  // Event snapshot
  const eventKey = "snapshot/event/event_demo.json";
  const eventPayload = {
    kind: "event",
    id: "event_demo",
    title: "FlameCon 2026",
    bannerUrl: "https://example.com/banner.jpg",
    iconUrl: "https://example.com/icon.jpg",
    status: "upcoming",
    periodText: "2026-11-01 - 2026-11-03",
    internalBudget: 100000,
  };
  const eventBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, generation, key: eventKey, visibility: "public",
    payload: eventPayload, sha256: sha256(eventPayload)
  }));
  const eventOpts = options({ schemaVersion: 1, generation, allowedKeys: [eventKey], blockedKeys: [] });
  const eventSnapshot = await loadPublicBuildSnapshot(source(eventBytes), eventKey, eventOpts);
  assert.equal(eventSnapshot.kind, "event");
  assert.equal(eventSnapshot.bannerUrl, "https://example.com/banner.jpg");
  assert.equal(eventSnapshot.status, "upcoming");
  assert.equal(eventSnapshot.periodText, "2026-11-01 - 2026-11-03");
  assert.equal("internalBudget" in eventSnapshot, false);
});

test("MIG-0403 T02: alias fixture correctly points to primary canonical ID", async () => {
  const aliasKey = "snapshot/video/public_alias.json";
  const aliasPayload = {
    kind: "video",
    id: "public_alias",
    title: "Video Alias Title",
    canonicalUrl: "https://flamenode.net/public_demo",
    aliasOf: "public_demo",
  };
  const aliasBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, generation, key: aliasKey, visibility: "public",
    payload: aliasPayload, sha256: sha256(aliasPayload)
  }));
  const aliasOpts = options({ schemaVersion: 1, generation, allowedKeys: [aliasKey], blockedKeys: [] });
  const aliasSnapshot = await loadPublicBuildSnapshot(source(aliasBytes), aliasKey, aliasOpts);
  assert.equal(aliasSnapshot.canonicalUrl, "https://flamenode.net/public_demo");
  assert.equal(aliasSnapshot.aliasOf, "public_demo");
});


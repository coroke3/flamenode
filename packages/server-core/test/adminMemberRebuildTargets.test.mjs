import assert from "node:assert/strict";
import { test } from "node:test";
import { adminVideoMembersRebuildTargets } from "../src/video/adminMemberRebuildTargets.ts";

const base = () => ({
  videoId: "v1", actorUserId: "admin",
  publicContentChanged: false, membersPlanChanged: false,
  eventIds: ["event-b", "event-a"],
  isPublicVideo: true,
  affectedCreatorIds: new Set(["alice", "bob"]),
});

test("SA-085: no content or member changes creates only affected public member aggregate targets", () => {
  assert.deepEqual(adminVideoMembersRebuildTargets(base()), [
    { targetType: "users_index", targetId: "global", reason: "video_members_update" },
    { targetType: "user", targetId: "alice", reason: "video_members_update" },
    { targetType: "user", targetId: "bob", reason: "video_members_update" },
  ]);
  assert.deepEqual(adminVideoMembersRebuildTargets({
    ...base(), affectedCreatorIds: new Set(),
  }), []);
});

test("SA-085: full public member update has CURRENT ordering and event priority", () => {
  assert.deepEqual(adminVideoMembersRebuildTargets({
    ...base(), publicContentChanged: true, membersPlanChanged: true,
  }), [
    { targetType: "video", targetId: "v1", reason: "video_members_update", requestedByUserId: "admin" },
    { targetType: "member_suggestions", targetId: "global", reason: "video_members_update" },
    { targetType: "event_release", targetId: "event-b", reason: "video_members_update", priority: "high", requestedByUserId: "admin" },
    { targetType: "event_release", targetId: "event-a", reason: "video_members_update", priority: "high", requestedByUserId: "admin" },
    { targetType: "users_index", targetId: "global", reason: "video_members_update" },
    { targetType: "user", targetId: "alice", reason: "video_members_update" },
    { targetType: "user", targetId: "bob", reason: "video_members_update" },
  ]);
});

test("SA-085: private updates skip public member aggregates without dropping required video/event targets", () => {
  const v = adminVideoMembersRebuildTargets({
    ...base(), isPublicVideo: false,
    publicContentChanged: true, membersPlanChanged: true,
  });
  assert.deepEqual(v.map((x) => x.targetType), [
    "video", "member_suggestions", "event_release", "event_release",
  ]);
});

test("SA-085: no public-content change does not queue event releases and only changed members request suggestions", () => {
  const v = adminVideoMembersRebuildTargets({
    ...base(), publicContentChanged: false, membersPlanChanged: true,
    affectedCreatorIds: new Set(),
  });
  assert.deepEqual(v, [
    { targetType: "member_suggestions", targetId: "global", reason: "video_members_update" },
  ]);
});

test("SA-085: each invocation owns its result and does not mutate caller inputs", () => {
  const input = base();
  const first = adminVideoMembersRebuildTargets({ ...input, publicContentChanged: true });
  first[0].targetId = "mutated";
  const second = adminVideoMembersRebuildTargets({ ...input, publicContentChanged: true });
  assert.equal(second[0].targetId, "v1");
  assert.deepEqual([...input.affectedCreatorIds], ["alice", "bob"]);
  assert.deepEqual(input.eventIds, ["event-b", "event-a"]);
});

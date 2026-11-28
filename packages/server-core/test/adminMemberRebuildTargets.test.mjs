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

test("MIG-0650 U03aw: legal 8-event / 200-public-X fanout remains below 256 Queue targets", () => {
  const eventIds = Array.from({ length: 8 }, (_, i) => "event_" + i);
  const affectedCreatorIds = new Set(
    Array.from({ length: 200 }, (_, i) => "creator_" + i),
  );
  const targets = adminVideoMembersRebuildTargets({
    ...base(),
    publicContentChanged: true,
    membersPlanChanged: true,
    eventIds, affectedCreatorIds,
  });
  assert.equal(targets.length, 211, "1 video + 1 suggestions + 8 events + 1 index + 200 users");
  assert.ok(targets.length <= 256, "queue accepts the complete CURRENT fanout");
  assert.deepEqual(
    targets.filter(t => t.targetType === "event_release").map(t => t.targetId),
    eventIds, "all eight event releases are retained in CURRENT order",
  );
  assert.equal(targets.filter(t => t.targetType === "user").length, 200);
  assert.equal(eventIds.length, 8, "planner does not modify caller events");
  assert.equal(affectedCreatorIds.size, 200, "planner does not modify caller member set");
});

test("MIG-0650 U03aw: malformed Hono fanout cannot overrun event or public-member bounds", () => {
  const atMaxEvents = Array.from({ length: 8 }, (_, i) => "event_" + i);
  const atMaxUsers = new Set(Array.from({ length: 200 }, (_, i) => "creator_" + i));
  const overEvents = [...atMaxEvents, "event_8"];
  const overUsers = new Set([...atMaxUsers, "creator_200"]);
  for (const inputs of [
    { eventIds: overEvents, affectedCreatorIds: new Set() },
    { eventIds: atMaxEvents, affectedCreatorIds: overUsers },
    { eventIds: overEvents, affectedCreatorIds: overUsers, isPublicVideo: false },
  ]) {
    assert.throws(
      () => adminVideoMembersRebuildTargets({
        ...base(), publicContentChanged: true, membersPlanChanged: true, ...inputs,
      }),
      { name: "RangeError", message: "video_admin_member_rebuild_target_limit_exceeded" },
    );
  }
  assert.equal(overEvents.length, 9);
  assert.equal(overUsers.size, 201);
});

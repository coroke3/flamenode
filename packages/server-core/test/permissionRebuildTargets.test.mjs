import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionRebuildTargets } from "../src/video/permissionRebuildTargets.ts";

test("MIG-0650 public permissions fan out to member suggestions, new X users and all event releases", () => {
  assert.deepEqual(permissionRebuildTargets({
    hasNewXUsers: true,
    visibilityStatus: "public",
    eventIds: ["event-b", "event-a"],
    actorUserId: "actor",
  }), [
    { targetType: "member_suggestions", targetId: "global", reason: "video_permissions_batch", priority: "low" },
    { targetType: "users_index", targetId: "global", reason: "video_permissions_new_x_user", priority: "low", requestedByUserId: "actor" },
    { targetType: "event_release", targetId: "event-b", reason: "video_permissions_batch", priority: "high", requestedByUserId: "actor" },
    { targetType: "event_release", targetId: "event-a", reason: "video_permissions_batch", priority: "high", requestedByUserId: "actor" },
  ]);
});

test("MIG-0650 private permissions never enqueue event_release, but new-X index survives", () => {
  assert.deepEqual(permissionRebuildTargets({
    hasNewXUsers: true, visibilityStatus: "private",
    eventIds: ["event-1"], actorUserId: "actor",
  }).map(x => x.targetType), ["member_suggestions", "users_index"]);
});

test("MIG-0650 existing-X public mutation with no events emits only member suggestions", () => {
  assert.deepEqual(permissionRebuildTargets({
    hasNewXUsers: false, visibilityStatus: "public",
    eventIds: [], actorUserId: "actor",
  }), [
    { targetType: "member_suggestions", targetId: "global", reason: "video_permissions_batch", priority: "low" },
  ]);
});

test("MIG-0650 visibility change and unknown status are fail-closed for event releases", () => {
  for (const visibilityStatus of ["scheduled", "unlisted", null]) {
    const targets = permissionRebuildTargets({
      hasNewXUsers: false, visibilityStatus, eventIds: ["private-event"], actorUserId: "actor",
    });
    assert.deepEqual(targets.map(x => x.targetType), ["member_suggestions"]);
  }
});

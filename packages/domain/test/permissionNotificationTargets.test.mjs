import assert from "node:assert/strict";
import { test } from "node:test";
import { selectVideoPermissionNotificationTargets } from "../src/video/permissionNotificationTargets.ts";

test("MIG-0650: author is excluded and repeated linked recipient pairs are deduplicated", () => {
  const actual = selectVideoPermissionNotificationTargets([
    { x_user_id: "alice", auth_user_id: "actor" },
    { x_user_id: "bob", auth_user_id: "viewer" },
    { x_user_id: "bob", auth_user_id: "viewer" },
    { x_user_id: "charlie", auth_user_id: "viewer" },
  ], "actor", "video-1");
  assert.deepEqual(actual, [
    { recipientUserId: "viewer", dedupeKey: "video_edit_permission_granted:video-1:x:bob:user:viewer" },
    { recipientUserId: "viewer", dedupeKey: "video_edit_permission_granted:video-1:x:charlie:user:viewer" },
  ]);
});

test("MIG-0650: target preserves first-seen order and distinct linked auth accounts", () => {
  const actual = selectVideoPermissionNotificationTargets([
    { x_user_id: "alice", auth_user_id: "first" },
    { x_user_id: "alice", auth_user_id: "second" },
    { x_user_id: "alice", auth_user_id: "first" },
  ], "actor", "video:with:colon");
  assert.deepEqual(actual.map(x => x.recipientUserId), ["first", "second"]);
  assert.deepEqual(actual.map(x => x.dedupeKey), [
    "video_edit_permission_granted:video:with:colon:x:alice:user:first",
    "video_edit_permission_granted:video:with:colon:x:alice:user:second",
  ]);
});

test("MIG-0650: empty or self-only links produce no notification targets", () => {
  assert.deepEqual(selectVideoPermissionNotificationTargets([], "actor", "v"), []);
  assert.deepEqual(selectVideoPermissionNotificationTargets([
    { x_user_id: "a", auth_user_id: "actor" },
    { x_user_id: "b", auth_user_id: "actor" },
  ], "actor", "v"), []);
});

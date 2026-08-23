import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canUseEventPrivilegeFromAccessContext,
  decideCanEditVideoFromAccessContext,
  resolveEventPermissionFromAccessContext,
} from "./ownershipCore.ts";

function context(overrides = {}) {
  return {
    userId: "user-1",
    videoId: "video-1",
    approvedXUserIds: ["x-1"],
    ownership: { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true },
    currentEventIds: ["event-1", "event-2"],
    ownerEditableFields: new Set(["title", "youtube_url"]),
    eventPermissionKeysByEvent: new Map([
      ["event-1", new Set(["video.credits"])],
      ["event-2", new Set(["video.youtube_id"])],
    ]),
    ...overrides,
  };
}

test("request-local context permits normal owner YouTube policy without a DB probe", () => {
  assert.equal(
    decideCanEditVideoFromAccessContext({
      context: context(),
      userRole: "user",
      requiredKey: "video.youtube_id",
      privilegeMode: "normal",
    }),
    true,
  );
});

test("collaborator ownership receives the same normal YouTube policy", () => {
  assert.equal(
    decideCanEditVideoFromAccessContext({
      context: context({
        ownership: { isCreatorOwner: false, isCollaboratorOwner: true, isOwner: true },
      }),
      userRole: "user",
      requiredKey: "video.youtube_id",
      privilegeMode: "normal",
    }),
    true,
  );
});

test("event permission is resolved from the in-memory event map", () => {
  const value = resolveEventPermissionFromAccessContext(context(), "video.youtube_id");
  assert.deepEqual(value, { allowed: true, eventId: "event-2" });
  assert.equal(canUseEventPrivilegeFromAccessContext(context()), true);
});

test("context ownership prevents a non-owner from using the owner policy", () => {
  assert.equal(
    decideCanEditVideoFromAccessContext({
      context: context({
        ownership: { isCreatorOwner: false, isCollaboratorOwner: false, isOwner: false },
      }),
      userRole: "user",
      requiredKey: "video.youtube_id",
      privilegeMode: "normal",
    }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveVideoOwnershipSync,
  adminPolicyAllows,
  creatorOwnerCanManagePermissions,
  ownerPolicyAllows,
  decideCanEditVideoFromAccessContext,
  shouldWarnManageActiveXMismatch,
  eventStaffCandidatePermissionKeys,
} from "@flamenode/domain/video";
import {
  ALL_PERMISSION_KEYS,
  LEGACY_PERMISSION_KEY_ALIASES,
  canonicalizePermissionKey,
  expandPermissionAliases,
  isValidPermissionKey,
} from "@flamenode/domain/auth/permissions";

test("resolveVideoOwnershipSync determines ownership flags accurately", () => {
  const creatorOnly = resolveVideoOwnershipSync({
    approvedXUserIds: ["123", "456"],
    creatorXUserId: "123",
    hasCollaboratorEdit: false,
  });
  assert.equal(creatorOnly.isCreatorOwner, true);
  assert.equal(creatorOnly.isCollaboratorOwner, false);
  assert.equal(creatorOnly.isOwner, true);

  const collabOnly = resolveVideoOwnershipSync({
    approvedXUserIds: ["456"],
    creatorXUserId: "123",
    hasCollaboratorEdit: true,
  });
  assert.equal(collabOnly.isCreatorOwner, false);
  assert.equal(collabOnly.isCollaboratorOwner, true);
  assert.equal(collabOnly.isOwner, true);

  const neither = resolveVideoOwnershipSync({
    approvedXUserIds: ["456"],
    creatorXUserId: "123",
    hasCollaboratorEdit: false,
  });
  assert.equal(neither.isCreatorOwner, false);
  assert.equal(neither.isCollaboratorOwner, false);
  assert.equal(neither.isOwner, false);
});

test("adminPolicyAllows verifies site admin permissions", () => {
  assert.equal(adminPolicyAllows("admin", "video.basics"), true);
  assert.equal(adminPolicyAllows("admin", "video.status"), true);
  assert.equal(adminPolicyAllows("user", "video.basics"), false);
  assert.equal(adminPolicyAllows(null, "video.basics"), false);
});

test("creatorOwnerCanManagePermissions allows only creator owners to manage permissions", () => {
  assert.equal(
    creatorOwnerCanManagePermissions(
      { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true },
      "video.permissions",
    ),
    true,
  );
  assert.equal(
    creatorOwnerCanManagePermissions(
      { isCreatorOwner: false, isCollaboratorOwner: true, isOwner: true },
      "video.permissions",
    ),
    false,
  );
  assert.equal(
    creatorOwnerCanManagePermissions(
      { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true },
      "video.basics",
    ),
    false,
  );
});

test("ownerPolicyAllows enforces field permissions and permissions management", () => {
  const fields = new Set(["title", "music"]);
  const creatorOwnership = { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true };
  const collabOwnership = { isCreatorOwner: false, isCollaboratorOwner: true, isOwner: true };

  assert.equal(ownerPolicyAllows(creatorOwnership, "video.permissions", fields), true);
  assert.equal(ownerPolicyAllows(collabOwnership, "video.permissions", fields), false);

  assert.equal(ownerPolicyAllows(creatorOwnership, "video.basics", fields), true);
  assert.equal(ownerPolicyAllows(creatorOwnership, "video.credits", fields), true);
  assert.equal(ownerPolicyAllows(creatorOwnership, "video.youtube_id", fields), false);
});

test("canonicalizePermissionKey and expandPermissionAliases map legacy keys", () => {
  assert.equal(canonicalizePermissionKey("videos.title"), "video.basics");
  assert.equal(canonicalizePermissionKey("video.basics"), "video.basics");
  assert.equal(canonicalizePermissionKey("invalid.key"), null);

  assert.deepEqual(expandPermissionAliases("videos.title"), ["video.basics"]);
  assert.deepEqual(expandPermissionAliases("video.basics"), ["video.basics"]);
  assert.deepEqual(expandPermissionAliases("invalid.key"), []);
});

test("shouldWarnManageActiveXMismatch detects mismatch with staff list", () => {
  assert.equal(shouldWarnManageActiveXMismatch(null, ["staff1"]), false);
  assert.equal(shouldWarnManageActiveXMismatch("staff1", ["staff1", "staff2"]), false);
  assert.equal(shouldWarnManageActiveXMismatch("staff3", ["staff1", "staff2"]), true);
  assert.equal(shouldWarnManageActiveXMismatch("  staff1  ", ["staff1"]), false);
});

function accessContext(overrides = {}) {
  return {
    userId: "u1",
    videoId: "v1",
    approvedXUserIds: ["creator"],
    ownership: { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true },
    currentEventIds: ["e1"],
    ownerEditableFields: new Set(["title"]),
    eventPermissionKeysByEvent: new Map(),
    ...overrides,
  };
}

test("decideCanEditVideoFromAccessContext keeps normal/event/admin modes separate", () => {
  const ctx = accessContext({
    eventPermissionKeysByEvent: new Map([["e1", new Set(["video.status"])]]),
  });
  // owner privileges never leak into event mode, and event keys never into normal mode
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "user", requiredKey: "video.basics", privilegeMode: "normal" }), true);
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "user", requiredKey: "video.basics", privilegeMode: "event" }), false);
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "user", requiredKey: "video.status", privilegeMode: "event" }), true);
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "user", requiredKey: "video.status", privilegeMode: "normal" }), false);
  // admin role does not fall back to event mode, and non-admin gets nothing in admin mode
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "admin", requiredKey: "video.basics", privilegeMode: "event" }), false);
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "user", requiredKey: "video.status", privilegeMode: "admin" }), false);
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "admin", requiredKey: "video.youtube_id", privilegeMode: "admin" }), true);
});

test("event mode only honours staff keys on events the video currently belongs to", () => {
  const ctx = accessContext({
    currentEventIds: ["e1"],
    eventPermissionKeysByEvent: new Map([["other", new Set(["video.basics"])]]),
  });
  assert.equal(decideCanEditVideoFromAccessContext({ context: ctx, userRole: "user", requiredKey: "video.basics", privilegeMode: "event" }), false);
});

test("eventStaffCandidatePermissionKeys returns canonical keys only", () => {
  assert.deepEqual([...eventStaffCandidatePermissionKeys("videos.title")].sort(), ["video.basics"]);
  assert.deepEqual(
    [...eventStaffCandidatePermissionKeys("video.member_chapters")].sort(),
    ["video.member_chapters", "video.members"],
  );
  for (const key of eventStaffCandidatePermissionKeys("video.chapter_admin")) {
    assert.equal(isValidPermissionKey(key), true, key);
  }
});

test("permission key registry is the single source for alias canonicalization", () => {
  for (const key of ALL_PERMISSION_KEYS) {
    assert.equal(canonicalizePermissionKey(key), key);
  }
  for (const legacy of LEGACY_PERMISSION_KEY_ALIASES) {
    assert.equal(isValidPermissionKey(canonicalizePermissionKey(legacy)), true, legacy);
  }
});

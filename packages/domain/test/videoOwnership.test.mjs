import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveVideoOwnershipSync,
  adminPolicyAllows,
  creatorOwnerCanManagePermissions,
  ownerPolicyAllows,
  decideCanEditVideoFromAccessContext,
  shouldWarnManageActiveXMismatch,
  canonicalizePermissionKey,
  expandPermissionAliases,
  sectionAllowedByGeneralFields,
  resolveGeneralEditableFieldsFromPolicy,
} from "@flamenode/domain/video";

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

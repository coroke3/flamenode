import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  hasAnyEditableVideoFormSection,
  resolvePermissionUnlockHint,
} from "./permissionUnlockHint.ts";
import { buildVideoEditPermissionViewModel } from "./videoEditPermissionView.ts";

const ownershipOwner = {
  isCreatorOwner: true,
  isCollaboratorOwner: false,
  isOwner: true,
};

test("resolvePermissionUnlockHint: editable なら null", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode: true,
    canOfferEventMode: true,
    sections: {
      identity: false,
      basics: true,
      youtube: false,
      credits: true,
      descriptions: true,
      members: true,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: true,
    },
  });
  assert.equal(resolvePermissionUnlockHint(vm.basics, vm), null);
});

test("resolvePermissionUnlockHint: admin_only は admin 案内", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode: true,
    canOfferEventMode: false,
    sections: {
      identity: false,
      basics: true,
      youtube: false,
      credits: true,
      descriptions: true,
      members: true,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });
  assert.equal(resolvePermissionUnlockHint(vm.youtube, vm), "admin");
});

test("resolvePermissionUnlockHint: event 案内を優先できる", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode: true,
    canOfferEventMode: true,
    sections: {
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });
  assert.equal(resolvePermissionUnlockHint(vm.basics, vm), "event");
});

test("resolvePermissionUnlockHint: admin_only は event 案内しない", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode: true,
    canOfferEventMode: true,
    sections: {
      identity: false,
      basics: true,
      youtube: false,
      credits: true,
      descriptions: true,
      members: true,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });
  assert.equal(resolvePermissionUnlockHint(vm.youtube, vm), "admin");
});

test("hasAnyEditableVideoFormSection: visibility/permissions は含めない", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode: false,
    canOfferEventMode: false,
    sections: {
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: true,
      permissions: true,
    },
  });
  assert.equal(hasAnyEditableVideoFormSection(vm), false);
});

test("hasAnyEditableVideoFormSection: memberChapters を含める", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode: false,
    canOfferEventMode: false,
    sections: {
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: true,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });
  assert.equal(hasAnyEditableVideoFormSection(vm), true);
});

test("フォーム: membersDisabled 時は is_collab 現状値を hidden 送信する", () => {
  const source = readFileSync(
    new URL("../../components/forms/VideoForm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /membersListDisabled \? \(/);
  assert.match(source, /value=\{isCollab \? "true" : "false"\}/);
});

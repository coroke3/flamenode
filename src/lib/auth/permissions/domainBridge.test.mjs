// MIG-0304: the legacy src/lib modules must stay thin re-export bridges of
// @flamenode/domain. If anyone re-introduces a local copy of the permission
// registry or the ownership policies, the identity checks below fail.
import assert from "node:assert/strict";
import test from "node:test";
import * as domainPermissions from "@flamenode/domain/auth/permissions";
import * as domainVideo from "@flamenode/domain/video";
import * as legacyKeys from "./keys.ts";
import * as legacyAliases from "./aliases.ts";
import * as legacyOwnershipCore from "../ownershipCore.ts";
import * as legacyGeneralEdit from "../../video/generalEditPermissionsCore.ts";

function assertBridge(legacy, domain, label) {
  const names = Object.keys(legacy);
  assert.ok(names.length > 0, `${label} exports nothing`);
  for (const name of names) {
    assert.ok(name in domain, `${label}.${name} is not provided by the domain package`);
    assert.equal(legacy[name], domain[name], `${label}.${name} is a copy, not a re-export`);
  }
}

test("permissions/keys.ts re-exports the domain registry", () => {
  assertBridge(legacyKeys, domainPermissions, "keys");
  assert.deepEqual(Object.keys(legacyKeys).sort(), [
    "ALL_PERMISSION_KEYS",
    "DANGEROUS_PERMISSION_KEYS",
    "EVENT_PERMISSION_KEYS",
    "PERMISSION_DEFINITIONS",
    "VIDEO_PERMISSION_KEYS",
    "isAdminOnlyKey",
    "isDangerousKey",
    "isValidPermissionKey",
  ]);
});

test("permissions/aliases.ts re-exports the domain aliases", () => {
  assertBridge(legacyAliases, domainPermissions, "aliases");
});

test("ownershipCore.ts and generalEditPermissionsCore.ts re-export domain/video", () => {
  assertBridge(legacyOwnershipCore, domainVideo, "ownershipCore");
  assertBridge(legacyGeneralEdit, domainVideo, "generalEditPermissionsCore");
});

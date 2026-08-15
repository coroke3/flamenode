import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

test("ManageAuthorizationSnapshotはrequest-scoped cacheとapproved JOINを使う", () => {
  const source = read("./manageAuthorization.ts");
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /export const getManageAuthorizationSnapshot = cache/);
  assert.match(source, /innerJoin\(\s*xUserAccountLinks/);
  assert.match(source, /innerJoin\(xUsers/);
  assert.match(source, /eq\(xUserAccountLinks\.auth_user_id, authUserId\)/);
  assert.match(source, /eq\(xUsers\.approval_status, "approved"\)/);
  assert.match(source, /resolveStaffPermissionKeys/);
  assert.match(source, /staffRowHasPermissionKey/);
  assert.match(source, /expandPermissionAliases/);
  assert.match(source, /getManageStaffRole/);
  assert.match(source, /const eventPermissions = permissionsByEvent\.get\(eventId\)/);
  assert.match(source, /for \(const key of permissionKeys\) eventPermissions\.add\(key\)/);
  assert.match(source, /manageableEventIds\.add\(eventId\)/);
  assert.match(source, /manageStaffXUserIds\.add\(xUserId\)/);
  assert.match(source, /if \(isAdmin\) return emptySnapshot\(authUserId, role, true\)/);
  assert.doesNotMatch(source, /unstable_cache|kv\.get|KVNamespace|setTimeout/);
});

test("RequestAuthContextは管理認可をsnapshotへ委譲し、enrichment失敗契約を維持する", () => {
  const source = read("./requestAuthContext.ts");
  assert.match(source, /getManageAuthorizationSnapshot\(authUserId, role\)/);
  assert.doesNotMatch(source, /from "@\/lib\/auth\/permissions\/permissionResolver"/);
  assert.match(source, /enrichmentFailed:\s*boolean/);
  assert.match(source, /let enrichmentFailed = false/);
  assert.match(source, /enrichmentFailed = true/);
  assert.match(source, /header_enrichment_failed/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [
  settingsHelper,
  pendingCounts,
  costGuardBanner,
  costGuardPage,
  usersPage,
  auditPage,
  audiencePage,
] =
  await Promise.all([
    readFile(new URL("./adminSystemSettings.ts", import.meta.url), "utf8"),
    readFile(new URL("./adminPendingCounts.ts", import.meta.url), "utf8"),
    readFile(new URL("../../components/layout/CostGuardBanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../app/(admin)/admin/cost-guard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../app/(admin)/admin/users/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../app/(admin)/admin/audit/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../../app/(manage)/manage/events/[id]/audience/page.tsx", import.meta.url),
      "utf8",
    ),
  ]);

test("admin system_settings reads are request-cached and do not use TTL/KV", () => {
  assert.match(settingsHelper, /import \{ cache \} from "react"/);
  assert.match(settingsHelper, /export const readAdminSystemSettings = cache\(/);
  assert.match(settingsHelper, /cost_guard_exception_until/);
  assert.match(settingsHelper, /cost_guard_exception_features_json/);
  assert.match(pendingCounts, /readAdminSystemSettings\(db\)/);
  assert.match(costGuardBanner, /readAdminSystemSettings\(db\)/);
  assert.match(costGuardPage, /readAdminSystemSettings\(db\)/);
  assert.doesNotMatch(costGuardPage, /from\(systemSettings\)/);
  assert.doesNotMatch(costGuardBanner, /from\(systemSettings\)/);
  assert.doesNotMatch(settingsHelper, /readOperationModeKvMirror|cacheTtl|setTimeout/);
});

test("admin/manage lists preserve canonical icons without video fallback reads", () => {
  assert.match(usersPage, /usersTable\.image/);
  assert.match(usersPage, /xUsersTable\.icon_url/);
  assert.match(usersPage, /resolveManageXIconUrl/);
  assert.match(usersPage, /<ManageXIcon/);
  assert.doesNotMatch(usersPage, /src=\{x\.icon_url\}/);
  assert.doesNotMatch(usersPage, /active_x_icon_url/);
  assert.doesNotMatch(auditPage, /usersTable\.image|xUsersTable\.icon_url|x_icon|iconUrl/);
  assert.match(audiencePage, /xUsersTable\.icon_url/);
  assert.match(audiencePage, /xUsersTable\.approval_status/);
  assert.match(audiencePage, /resolveManageXIconUrl/);
  assert.match(audiencePage, /ManageXIcon/);
  assert.doesNotMatch(audiencePage, /video-icons|includeVideoIconFallback/);
  assert.match(usersPage, /active_x_name/);
  assert.match(usersPage, /active_x_user_id/);
  assert.match(auditPage, /x_name: xUsersTable\.x_name/);
  assert.match(audiencePage, /x_name: xUsersTable\.x_name/);
});

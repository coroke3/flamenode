import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headerSource = await readFile(new URL("./headerUser.ts", import.meta.url), "utf8");
const helperSource = await readFile(
  new URL("./editableEventIdsByXIds.ts", import.meta.url),
  "utf8",
);
const linkedSource = await readFile(
  new URL("./headerLinkedXUsers.ts", import.meta.url),
  "utf8",
);

test("buildHeaderUser は同一requestで取得済みapproved X IDsを管理権限判定へ渡す", () => {
  assert.match(headerSource, /approval_status === "approved"/);
  assert.match(headerSource, /approvedXUserIds/);
  assert.match(headerSource, /getManagementAccessFromApprovedXIds/);
  assert.match(headerSource, /getEditableEventIdsByApprovedXIds\(db, approvedXUserIds\)/);
});

test("header X一覧は表示に必要な最小列だけを読み汎用profile JOINを使わない", () => {
  assert.match(headerSource, /getHeaderLinkedXUsersForAuthUser/);
  assert.doesNotMatch(headerSource, /getLinkedXUsersForAuthUser/);
  assert.match(linkedSource, /x_user_id: xUsers\.id/);
  assert.match(linkedSource, /x_name: xUsers\.x_name/);
  assert.match(linkedSource, /icon_url: xUsers\.icon_url/);
  assert.match(linkedSource, /approval_status: xUsers\.approval_status/);
  assert.doesNotMatch(linkedSource, /xIdentityRequests/);
  assert.doesNotMatch(linkedSource, /profile_text|portfolio_contact|other_social_links/);
});

test("preloaded approved X query は従来同様 permission を持つ event_staff だけを返す", () => {
  assert.match(helperSource, /approvedXIdsWhere\(eventStaff\.x_user_id, xIds\)/);
  assert.match(helperSource, /resolveStaffPermissionKeys\(row\)\.size > 0/);
  assert.match(helperSource, /editable_event_staff_read_limit_exceeded/);
});

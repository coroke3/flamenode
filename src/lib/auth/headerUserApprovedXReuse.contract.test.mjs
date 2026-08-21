import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headerSource = await readFile(new URL("./headerUser.ts", import.meta.url), "utf8");
const helperSource = await readFile(
  new URL("./editableEventIdsByXIds.ts", import.meta.url),
  "utf8",
);

test("buildHeaderUser は同一requestで取得済みapproved X IDsを管理権限判定へ渡す", () => {
  assert.match(headerSource, /approval_status === "approved"/);
  assert.match(headerSource, /approvedXUserIds/);
  assert.match(headerSource, /getManagementAccessFromApprovedXIds/);
  assert.match(headerSource, /getEditableEventIdsByApprovedXIds\(db, approvedXUserIds\)/);
});

test("preloaded approved X query は従来同様 permission を持つ event_staff だけを返す", () => {
  assert.match(helperSource, /approvedXIdsWhere\(eventStaff\.x_user_id, xIds\)/);
  assert.match(helperSource, /resolveStaffPermissionKeys\(row\)\.size > 0/);
  assert.match(helperSource, /editable_event_staff_read_limit_exceeded/);
});

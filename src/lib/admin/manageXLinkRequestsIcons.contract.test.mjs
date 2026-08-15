import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [enrichSource, adminPageSource, managePageSource, tableSource] = await Promise.all([
  readFile(new URL("./enrichXLinkPendingRows.ts", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../../../app/(admin)/admin/x-link-requests/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../../../app/(manage)/manage/x-link-requests/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../../components/admin/XLinkRequestTable.tsx", import.meta.url), "utf8"),
]);

test("X link pending enrichment keeps canonical approval status in the same batch", () => {
  assert.match(enrichSource, /approval_status: xUsers\.approval_status/);
  assert.match(enrichSource, /requested_approval_status/);
  assert.match(enrichSource, /target_approval_status/);
  assert.match(enrichSource, /normalizeXId\(row\.id\)/);
  assert.match(enrichSource, /inArray\(xUsers\.id, chunk\)/);
  assert.match(enrichSource, /lower\(trim\(\$\{xUsers\.id\}\)\)/);
  assert.match(enrichSource, /includeVideoIconFallback/);
  assert.match(enrichSource, /videos\.creator_x_user_id/);
  assert.match(enrichSource, /videos\.creator_icon_url/);
  assert.match(enrichSource, /isNotNull\(videos\.creator_icon_url\)/);
});

test("Manage X link requests signs only approved internal icons before rendering", () => {
  assert.match(managePageSource, /resolveManageXIconUrl/);
  assert.match(managePageSource, /row\.requested_approval_status/);
  assert.match(managePageSource, /row\.target_approval_status/);
  assert.match(managePageSource, /includeVideoIconFallback:\s*true/);
});

test("Admin X link requests also avoid the public media ACL path", () => {
  assert.match(adminPageSource, /resolveManageXIconUrl/);
  assert.match(adminPageSource, /row\.requested_approval_status/);
  assert.match(adminPageSource, /row\.target_approval_status/);
  assert.doesNotMatch(adminPageSource, /includeVideoIconFallback/);
});

test("X link request avatars use the Manage fallback component", () => {
  assert.match(tableSource, /import \{ ManageXIcon \}/);
  assert.match(tableSource, /<ManageXIcon/);
  assert.doesNotMatch(tableSource, /src=\{iconUrl\}/);
});

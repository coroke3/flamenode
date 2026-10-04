import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headerSource = await readFile(new URL("./headerUser.ts", import.meta.url), "utf8");
const currentUserSource = await readFile(new URL("./currentUser.ts", import.meta.url), "utf8");
const helperSource = await readFile(
  new URL("./editableEventIdsByXIds.ts", import.meta.url),
  "utf8",
);
const linkedSource = await readFile(
  new URL("./headerLinkedXUsers.ts", import.meta.url),
  "utf8",
);
const accountSummarySource = await readFile(
  new URL("../../../app/api/account/summary/route.ts", import.meta.url),
  "utf8",
);

test("buildHeaderUser は同一requestで取得済みapproved X IDsを管理権限判定へ渡す", () => {
  assert.match(headerSource, /approval_status === "approved"/);
  assert.match(headerSource, /approvedXUserIds/);
  assert.match(headerSource, /getManagementAccessFromApprovedXIds/);
  assert.match(
    headerSource,
    /hasEditableEventByApprovedXIds\(\s*db,\s*approvedXUserIds/,
  );
});

test("header manage可否は権限preset/JSONを保ってbounded existence queryを使う", () => {
  assert.match(headerSource, /hasEditableEventByApprovedXIds/);
  assert.doesNotMatch(headerSource, /getEditableEventIds/);
  assert.match(helperSource, /export async function hasEditableEventByApprovedXIds/);
  assert.match(helperSource, /PRESETS_WITH_PERMISSIONS/);
  assert.match(helperSource, /PERMISSION_KEY_INPUTS/);
  assert.match(helperSource, /json_each\(/);
  assert.match(helperSource, /json_valid\(/);
  assert.match(helperSource, /\.limit\(1\)/);
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

test("current user context はactive X解決で読んだlinked rowsをrequest内に保持する", () => {
  assert.match(currentUserSource, /getCachedCurrentUserContext = cache\(loadCurrentUserContext\)/);
  assert.match(
    currentUserSource,
    /getCurrentUserContext = \(\): Promise<CurrentUserContext> =>\s*getCachedCurrentUserContext\(true\)/,
  );
  assert.match(
    currentUserSource,
    /getAccountSummaryCurrentUserContext[\s\S]*?getCachedCurrentUserContext\(false\)/,
  );
  assert.match(
    currentUserSource,
    /const requiredMajor = await getLatestPublishedMajorTerms\(db\)/,
  );
  assert.match(currentUserSource, /getHeaderLinkedXUsersForAuthUser\(db, userId\)/);
  assert.match(
    currentUserSource,
    /resolveActiveXUserId\([\s\S]*linkedXUsers[\s\S]*\)/,
  );
  assert.match(currentUserSource, /linkedXUsers,/);
});

test("account summary は current-user DB正本snapshotとlinked X rowsを再利用する", () => {
  const detailRouteSource = accountSummarySource.slice(
    accountSummarySource.indexOf("async function getDetails"),
    accountSummarySource.indexOf("export async function GET"),
  );
  assert.match(accountSummarySource, /getAccountSummaryCurrentUserContext/);
  assert.doesNotMatch(detailRouteSource, /getLatestPublishedMajorTerms|termsReacceptRequiredValue/);
  assert.match(accountSummarySource, /authoritativeUserSnapshot/);
  assert.match(accountSummarySource, /authoritativeLinkedXRows: currentContext\.linkedXUsers/);
  assert.match(accountSummarySource, /role: sessionUser\.role/);
  assert.match(accountSummarySource, /active_x_user_id: sessionUser\.active_x_user_id/);
  assert.match(accountSummarySource, /async function getPresence[\s\S]*?getAuthSession/);
  assert.doesNotMatch(detailRouteSource, /getAuthSession/);
  assert.match(headerSource, /resolveAuthoritativeUserSnapshot/);
  assert.match(headerSource, /authoritativeLinkedXRows/);
});

test("preloaded approved X query は従来同様 permission を持つ event_staff だけを返す", () => {
  assert.match(helperSource, /approvedXIdsWhere\(eventStaff\.x_user_id, xIds\)/);
  // JS resolverとの判定一致は editableEventIdsByXIds.sqlite.execution.test.mjs で実行検証する。
  assert.match(helperSource, /json_type\(/);
  assert.doesNotMatch(helperSource, /getEditableEventIdsByApprovedXIds/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [route, island, publicHeader, publicLayout, accountMenu, signOutButton] = await Promise.all([
  readFile(
    new URL("../../../app/api/account/summary/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/layout/PublicAccountIsland.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/layout/PublicHeader.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../app/(public)/layout.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/user/AccountMenu.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/auth/SignOutButton.tsx", import.meta.url),
    "utf8",
  ),
]);

test("account summary APIはprivate no-storeで最小DTOだけを返す", () => {
  assert.match(route, /"Cache-Control": "private, no-store, no-cache, must-revalidate"/);
  assert.match(route, /Pragma: "no-cache"/);
  assert.match(route, /Expires: "0"/);
  assert.match(route, /loggedIn: true/);
  assert.match(route, /loggedIn: false/);
  assert.match(route, /unavailable: true/);
  assert.match(route, /degraded: true/);
  assert.match(route, /displayName: headerUser\.name/);
  assert.match(route, /canAccessAdmin: headerUser\.management\.canAccessAdmin/);
  assert.doesNotMatch(route, /id: headerUser\.id/);
});

test("presenceはcookie名を推測せず、cookie headerが無い時だけAuth.jsを省略する", () => {
  const presenceRoute = route.slice(
    route.indexOf("async function getPresence"),
    route.indexOf("async function getDetails"),
  );
  assert.match(
    presenceRoute,
    /if \(!request\.headers\.get\("cookie"\)\?\.trim\(\)\) return presenceLoggedOut\(\);/,
  );
  assert.match(presenceRoute, /await getAuthSession\(\)/);
  assert.doesNotMatch(presenceRoute, /authjs\.session-token|__Secure-/i);
  assert.doesNotMatch(presenceRoute, /getCurrentUserContext|buildHeaderUser/);
  assert.ok(
    presenceRoute.indexOf('request.headers.get("cookie")') <
      presenceRoute.indexOf("await getAuthSession()"),
  );
});

test("degraded summaryはDB正本のlinked Xとapproval statusを維持する", () => {
  assert.match(route, /degraded: true/);
  assert.match(route, /currentContext\.linkedXUsers\.map/);
  assert.match(route, /normalizeXIdApprovalStatus\(entry\.approval_status\)/);
  assert.match(route, /is_active: entry\.x_user_id === sessionUser\.active_x_user_id/);
  assert.doesNotMatch(route, /approval_status: "approved" as const/);
  assert.match(accountMenu, /resolveAccountMenuDisplayName/);
  assert.match(accountMenu, /degraded: user\.degraded === true/);
  assert.match(publicHeader, /management: fetchedUser\.management/);
  assert.doesNotMatch(
    publicHeader,
    /canAccessAdmin:\s*fetchedUser\.management\.canAccessAdmin\s*\|\|\s*serverUser\.management\.canAccessAdmin/,
  );
  assert.doesNotMatch(
    publicHeader,
    /fetchedUser\.management\.canAccessManage\s*\|\|\s*serverUser\.management\.canAccessManage/,
  );
});

test("summaryのlinked X空配列も正本としてSSRの古いActive Xを残さない", () => {
  assert.match(publicHeader, /xIds: fetchedUser\.xIds/);
  assert.doesNotMatch(
    publicHeader,
    /fetchedUser\.xIds\.length > 0 \? fetchedUser\.xIds : serverUser\.xIds/,
  );
});

test("正常なloggedOut summaryはSSRの古いログイン表示を破棄する", () => {
  assert.match(island, /confirmedLoggedOut: boolean/);
  assert.match(island, /setConfirmedLoggedOut\(true\)/);
  assert.match(island, /setConfirmedLoggedOut\(false\)/);
  assert.match(
    island,
    /presenceUserRef\.current = null;\s*setUser\(null\);\s*setConfirmedLoggedOut\(true\);/,
  );
  assert.match(
    publicHeader,
    /confirmedLoggedOut: accountConfirmedLoggedOut/,
  );
  assert.match(publicHeader, /const accountUser = accountConfirmedLoggedOut\s*\? null/);
});

test("公開layoutとAccount Islandはserver authを呼ばない", () => {
  assert.doesNotMatch(publicLayout, /getCurrentUser/);
  assert.doesNotMatch(publicLayout, /buildHeaderUser/);
  assert.doesNotMatch(publicLayout, /CostGuardBanner/);
  assert.doesNotMatch(publicLayout, /source=["']admin["']/);
  assert.match(island, /\/api\/account\/summary/);
  assert.match(island, /cache: "no-store"/);
  assert.match(island, /preserveLoggedInOnFailure/);
  assert.match(island, /response\.status === 503 \|\| !response\.ok/);
  assert.match(island, /setUnavailable\(true\)/);
  assert.match(island, /summary\.unavailable/);
  assert.match(island, /ログイン状態を再確認/);
  assert.match(island, /if \(unavailable \|\| !user\) \{/);
  assert.match(island, /detailsUnavailable/);
  assert.match(
    island,
    /if \(!preserveLoggedInOnFailureRef\.current\) \{\s*presenceUserRef\.current = null;\s*setUser\(null\);/,
  );
});

test("公開headerはpresenceをhydration直後に取得し、詳細はメニュー操作まで遅延する", () => {
  assert.match(
    publicHeader,
    /usePublicAccountSummary\(\s*fetchAccount,\s*accountOpen\s*\|\|\s*mobileOpen,\s*true,\s*\)/,
  );
  assert.doesNotMatch(publicHeader, /hydrateOnOpen|deferPublicAccountUntilIdle/);
  assert.doesNotMatch(island, /requestIdleCallback|deferUntilIdle|lazyRef/);
  assert.match(island, /fetch\("\/api\/account\/summary\?view=presence"/);
  assert.match(island, /fetch\("\/api\/account\/summary"/);
  assert.match(island, /presenceStartedRef\.current/);
  assert.match(island, /detailsStartedRef\.current/);
  assert.match(island, /detailsRequested/);
  assert.match(publicHeader, /accountLoading && !accountUser/);
  assert.match(publicHeader, /accountUnavailable && !accountUser/);
  assert.match(publicHeader, /fetchAccount && !fetchedUser && serverPresenceUser/);
  assert.match(publicHeader, /function toPresenceOnlyUser/);
  assert.match(publicHeader, /accountDetailsLoaded: false/);
});

test("presenceとfull detail requestにはtimeoutと同一layout内dedupeを適用する", () => {
  assert.match(island, /const PUBLIC_ACCOUNT_FETCH_TIMEOUT_MS = 5_000/);
  assert.match(island, /const controller = new AbortController\(\)/);
  assert.match(island, /controller\.abort\(\)/);
  assert.match(island, /signal: controller\.signal/);
  assert.match(island, /window\.clearTimeout\(timeoutId\)/);
  assert.match(island, /presenceStartedRef\.current = true/);
  assert.match(island, /detailsStartedRef\.current = true/);
  assert.doesNotMatch(island, /localStorage/);
});

test("full detail未取得中にX IDなし/管理リンクを確定表示しない", () => {
  assert.match(accountMenu, /!detailsReady\s*\?/);
  assert.match(accountMenu, /X ID と管理メニューは、最新のアカウント情報を確認してから表示します/);
  assert.match(
    accountMenu,
    /detailsReady &&\s*\(user\.management\.canAccessAdmin \|\| user\.management\.canAccessManage\)/,
  );
  assert.match(island, /detailsReady &&/);
});

test("Active X変更後はfull detailを再検証し、障害時はprivileged detailを隠す", () => {
  assert.match(island, /ACTIVE_X_CHANGED_EVENT/);
  assert.match(island, /window\.addEventListener\(ACTIVE_X_CHANGED_EVENT, requestDetailsRetry\)/);
  assert.match(island, /setUser\(presenceUserRef\.current\)/);
  assert.match(island, /detailsUnavailable/);
  assert.match(island, /onRetryDetails/);
});

test("PublicAccountIsland は ACTIVE_X_CHANGED_EVENT で summary を再取得する", () => {
  assert.match(island, /ACTIVE_X_CHANGED_EVENT/);
  assert.match(island, /addEventListener\(ACTIVE_X_CHANGED_EVENT/);
  assert.match(island, /detailsRequested/);
  assert.match(island, /detailsStartedRef/);
});

test("account summary一時失敗は自動loopせず明示的に再試行できる", () => {
  assert.match(island, /PUBLIC_ACCOUNT_RETRY_EVENT/);
  assert.match(island, /requestPublicAccountRetry/);
  assert.match(island, /dispatchEvent\(new Event\(PUBLIC_ACCOUNT_RETRY_EVENT\)\)/);
  assert.match(island, /addEventListener\(PUBLIC_ACCOUNT_RETRY_EVENT, requestPresenceRetry\)/);
  assert.match(island, /removeEventListener\([\s\S]*?PUBLIC_ACCOUNT_RETRY_EVENT,[\s\S]*?requestPresenceRetry/);
  assert.match(island, /onClick=\{requestPublicAccountRetry\}/);
  assert.match(island, /presenceStartedRef\.current = false/);
  assert.match(island, /setPresenceRetryNonce\(\(current\) => current \+ 1\)/);
  assert.match(island, /presenceRetryNonce, preserveLoggedInOnFailure/);
  assert.match(island, /detailsStartedRef\.current = false/);
  assert.match(island, /PUBLIC_ACCOUNT_DETAILS_RETRY_EVENT/);
});

test("ログアウトはSignOutButton経由でhard navigateする", () => {
  assert.match(island, /import \{ SignOutButton \} from "@\/components\/auth\/SignOutButton"/);
  assert.match(island, /<SignOutButton/);
  assert.doesNotMatch(island, /onBeforeSignOut/);
  assert.match(accountMenu, /import \{ SignOutButton \} from "@\/components\/auth\/SignOutButton"/);
  assert.match(accountMenu, /<SignOutButton/);
  assert.doesNotMatch(accountMenu, /onBeforeSignOut/);
  assert.doesNotMatch(island, /<form action=\{authSignOut\}>/);
  assert.doesNotMatch(accountMenu, /<form action=\{authSignOut\}>/);
  assert.doesNotMatch(island, /\/api\/auth\/signout/);
  assert.doesNotMatch(accountMenu, /\/api\/auth\/signout/);
  assert.match(signOutButton, /signOutViaAuthRoute/);
  assert.doesNotMatch(signOutButton, /@\/lib\/actions\/authSignOut/);
  assert.match(signOutButton, /window\.location\.replace\("\/"\)/);
});

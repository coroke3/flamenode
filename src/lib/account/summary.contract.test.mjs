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

test("degraded summaryはDB正本のlinked Xとapproval statusを維持する", () => {
  assert.match(route, /degraded: true/);
  assert.match(route, /currentContext\.linkedXUsers\.map/);
  assert.match(route, /normalizeXIdApprovalStatus\(entry\.approval_status\)/);
  assert.match(route, /is_active: entry\.x_user_id === sessionUser\.active_x_user_id/);
  assert.doesNotMatch(route, /approval_status: "approved" as const/);
  assert.match(accountMenu, /resolveAccountMenuDisplayName/);
  assert.match(accountMenu, /degraded: user\.degraded === true/);
  assert.match(publicHeader, /canAccessAdmin: fetchedUser\.management\.canAccessAdmin/);
  assert.doesNotMatch(
    publicHeader,
    /canAccessAdmin:\s*fetchedUser\.management\.canAccessAdmin\s*\|\|\s*serverUser\.management\.canAccessAdmin/,
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
    /else \{[\s\S]*?setUser\(null\);\s*setConfirmedLoggedOut\(true\);\s*setUnavailable\(false\);/,
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
  assert.match(island, /kind: "unavailable"/);
  assert.match(island, /if \(!preserveLoggedInOnFailureRef\.current\) setUser\(null\)/);
});

test("公開headerはaccount summaryを操作時だけ取得し匿名pageviewのAuth fan-outを作らない", () => {
  assert.match(publicHeader, /const publicClientAccount =\s*serverUser === undefined && !hydrateAccount/);
  assert.match(
    publicHeader,
    /const hydrateOnOpen =\s*\(hydrateAccount && serverUser != null\) \|\| publicClientAccount/,
  );
  assert.match(publicHeader, /const accountHydrationOpen = accountOpen \|\| mobileOpen/);
  assert.match(
    publicHeader,
    /usePublicAccountSummary\([\s\S]*hydrateOnOpen,[\s\S]*accountHydrationOpen,[\s\S]*false,[\s\S]*\)/,
  );
  assert.doesNotMatch(publicHeader, /deferPublicAccountUntilIdle/);
  assert.match(publicHeader, /const accountUnknown =/);
  assert.match(publicHeader, /const openAccountProbe = \(\) => \{/);
  assert.match(publicHeader, /aria-label="アカウントを確認"/);
  assert.match(publicHeader, /onClick=\{openAccountProbe\}/);
  assert.match(
    island,
    /if \(lazy && !open && !refreshRequestedRef\.current\) \{/,
  );
});

test("account summaryのin-flight requestは無期限にloadingを維持しない", () => {
  assert.match(island, /const PUBLIC_ACCOUNT_FETCH_TIMEOUT_MS = 5_000/);
  assert.match(island, /const controller = new AbortController\(\)/);
  assert.match(island, /controller\.abort\(\)/);
  assert.match(island, /signal: controller\.signal/);
  assert.match(island, /window\.clearTimeout\(timeoutId\)/);
  assert.match(island, /return \{ kind: "unavailable" as const \}/);
});

test("PublicAccountIsland は ACTIVE_X_CHANGED_EVENT で summary を再取得する", () => {
  assert.match(island, /ACTIVE_X_CHANGED_EVENT/);
  assert.match(island, /addEventListener\(ACTIVE_X_CHANGED_EVENT/);
  assert.match(island, /setRefreshNonce/);
  assert.match(island, /fetchedOnceRef/);
  assert.match(island, /nonLazyAttemptedRef/);
  assert.match(island, /!lazy && nonLazyAttemptedRef\.current/);
  assert.match(island, /inFlightRef/);
  assert.match(island, /if \(inFlight\)/);
  assert.match(island, /refreshGenerationRef/);
  assert.match(island, /request\.generation !== refreshGenerationRef\.current/);
});

test("account summary一時失敗は自動loopせず明示的に再試行できる", () => {
  assert.match(island, /PUBLIC_ACCOUNT_RETRY_EVENT/);
  assert.match(island, /requestPublicAccountRetry/);
  assert.match(island, /dispatchEvent\(new Event\(PUBLIC_ACCOUNT_RETRY_EVENT\)\)/);
  assert.match(island, /addEventListener\(PUBLIC_ACCOUNT_RETRY_EVENT, requestRefresh\)/);
  assert.match(island, /removeEventListener\(PUBLIC_ACCOUNT_RETRY_EVENT, requestRefresh\)/);
  assert.match(island, /onClick=\{requestPublicAccountRetry\}/);
  assert.match(island, /refreshRequestedRef\.current = true/);
  assert.match(
    island,
    /!lazyRef\.current \|\| openRef\.current \|\| refreshRequestedRef\.current/,
  );
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [route, island, publicLayout, accountMenu, signOutButton] = await Promise.all([
  readFile(
    new URL("../../../app/api/account/summary/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../components/layout/PublicAccountIsland.tsx", import.meta.url),
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

test("degraded synthetic X entry does not replace the account display name", () => {
  assert.match(route, /degraded: true/);
  assert.match(route, /x_name: `@\$\{sessionUser\.active_x_user_id\}`/);
  assert.match(accountMenu, /resolveAccountMenuDisplayName/);
  assert.match(accountMenu, /degraded: user\.degraded === true/);
});

test("公開layoutとAccount Islandはserver authを呼ばない", () => {
  assert.doesNotMatch(publicLayout, /getCurrentUser/);
  assert.doesNotMatch(publicLayout, /buildHeaderUser/);
  assert.match(publicLayout, /CostGuardBanner/);
  assert.doesNotMatch(publicLayout, /source=["']admin["']/);
  assert.match(island, /\/api\/account\/summary/);
  assert.match(island, /cache: "no-store"/);
  assert.match(island, /preserveLoggedInOnFailure/);
  assert.match(island, /response\.status === 503 \|\| !response\.ok/);
  assert.match(island, /setUnavailable\(true\)/);
  assert.match(island, /summary\.unavailable/);
  assert.match(island, /ログイン状態を一時的に確認できません/);
  assert.match(island, /if \(unavailable \|\| !user\) \{/);
  assert.match(island, /kind: "unavailable"/);
  assert.match(island, /if \(!preserveLoggedInOnFailureRef\.current\) setUser\(null\)/);
});

test("PublicAccountIsland は ACTIVE_X_CHANGED_EVENT で summary を再取得する", () => {
  assert.match(island, /ACTIVE_X_CHANGED_EVENT/);
  assert.match(island, /addEventListener\(ACTIVE_X_CHANGED_EVENT/);
  assert.match(island, /setRefreshNonce/);
  assert.match(island, /\[enabled, preserveLoggedInOnFailure, lazy, open, refreshNonce\]/);
  assert.match(island, /lazy && !open/);
  assert.match(island, /fetchedOnceRef/);
  assert.match(island, /nonLazyAttemptedRef/);
  assert.match(island, /!lazy && nonLazyAttemptedRef\.current/);
  assert.match(island, /inFlightRef/);
  assert.match(island, /if \(inFlight\)/);
  assert.match(island, /refreshGenerationRef/);
  assert.match(island, /request\.generation !== refreshGenerationRef\.current/);
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [
  authComplete,
  onboardingUrls,
  entryPage,
  completePage,
  requestAuth,
  terms,
] = await Promise.all([
  readFile(new URL("./authComplete.ts", import.meta.url), "utf8"),
  readFile(new URL("./onboardingUrls.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(auth)/entry/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../../../app/(auth-complete)/auth/complete/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("./requestAuthContext.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/terms.ts", import.meta.url), "utf8"),
]);

test("Discord signInは /auth/complete を経由する", () => {
  assert.match(onboardingUrls, /entryLoginRedirectTo/);
  assert.match(onboardingUrls, /authComplete/);
  assert.match(authComplete, /buildAuthCompleteHref/);
  assert.match(authComplete, /sanitizeAuthCompleteNext/);
  assert.match(authComplete, /\/auth\/complete/);
  assert.match(completePage, /getAuthSession/);
  assert.match(completePage, /redirect\(next\)/);
  assert.doesNotMatch(completePage, /getLinkedXUsersForAuthUser|buildHeaderUser|revalidatePath/);
});

test("auth completeはopen redirectと循環を拒否する", async () => {
  const { sanitizeAuthCompleteNext, buildAuthCompleteHref } = await import(
    "./authComplete.ts"
  );
  assert.equal(sanitizeAuthCompleteNext("https://evil.example"), "/onboarding");
  assert.equal(sanitizeAuthCompleteNext("//evil.example"), "/onboarding");
  assert.equal(sanitizeAuthCompleteNext("/auth/complete?next=/dashboard"), "/onboarding");
  assert.equal(sanitizeAuthCompleteNext("/api/auth/callback/discord"), "/onboarding");
  assert.match(buildAuthCompleteHref("/dashboard"), /^\/auth\/complete\?next=/);
});

test("entryはAuth.js error codeを安全に表示する", () => {
  assert.match(entryPage, /AccessDenied/);
  assert.match(entryPage, /OAuthCallbackError/);
  assert.match(entryPage, /AccountNotLinked/);
  assert.match(entryPage, /Configuration/);
  assert.match(entryPage, /auth_temporarily_unavailable/);
  assert.doesNotMatch(entryPage, /access_token|refresh_token|AUTH_SECRET/);
});

test("RequestAuthContextはlayout向けに1経路へ集約する", () => {
  assert.match(requestAuth, /getRequestAuthContext = cache/);
  assert.match(requestAuth, /getCurrentUser/);
  assert.match(requestAuth, /buildMinimalHeaderUser|MinimalHeaderUser/);
  assert.match(requestAuth, /enrichmentFailed/);
  assert.match(requestAuth, /header_enrichment_failed|追加情報の失敗/);
});

test("規約同意はCommit後にrevalidateせずredirectする", () => {
  assert.doesNotMatch(terms, /revalidatePath\(/);
  assert.match(terms, /unstable_rethrow/);
  assert.match(terms, /commitAcceptLatestTerms/);
  assert.match(terms, /already_accepted/);
});

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
  authIndex,
  authSignOut,
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
  readFile(new URL("./index.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/authSignOut.ts", import.meta.url), "utf8"),
]);

test("Discord signInは /auth/complete を経由する", () => {
  assert.match(onboardingUrls, /entryLoginRedirectTo/);
  assert.match(onboardingUrls, /authComplete/);
  assert.match(authComplete, /buildAuthCompleteHref/);
  assert.match(authComplete, /sanitizeAuthCompleteNext/);
  assert.match(authComplete, /\/auth\/complete/);
  assert.match(completePage, /loadAuthSessionUncached/);
  assert.match(completePage, /resolveAuthCompleteSession/);
  assert.match(completePage, /redirect\(next\)/);
  assert.doesNotMatch(
    completePage,
    /getDatabaseAsync|users\.id|getLinkedXUsersForAuthUser|buildHeaderUser|revalidatePath/,
  );
  assert.match(completePage, /auth_session_retry_recovered/);
  assert.match(completePage, /sessionUser\.is_banned === 1/);
});

test("auth completeはcallback直後のsession未反映を自動再試行する", async () => {
  const {
    AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS,
    resolveAuthCompleteSession,
  } = await import("./authComplete.ts");
  const waits = [];
  let reads = 0;
  const resolution = await resolveAuthCompleteSession(
    async () => {
      reads += 1;
      if (reads === 1) return null;
      if (reads === 2) throw new Error("transient session read");
      return { user: { id: "user-1", is_banned: 0 } };
    },
    async (ms) => {
      waits.push(ms);
    },
  );

  assert.equal(resolution.kind, "authenticated");
  assert.equal(resolution.attempts, 3);
  assert.equal(reads, 3);
  assert.deepEqual(
    waits,
    AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS.slice(0, 2),
  );
});

test("auth completeは再試行後も読めないsessionを成功扱いしない", async () => {
  const {
    AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS,
    resolveAuthCompleteSession,
  } = await import("./authComplete.ts");
  let reads = 0;
  const resolution = await resolveAuthCompleteSession(
    async () => {
      reads += 1;
      return null;
    },
    async () => {},
  );

  assert.deepEqual(resolution, {
    kind: "missing",
    attempts: AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS.length + 1,
  });
  assert.equal(reads, AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS.length + 1);
  assert.match(completePage, /session_missing_after_retry/);
  assert.match(completePage, /result: "skipped"/);
  assert.match(completePage, /redirect\("\/entry"\)/);
  assert.match(completePage, /auth_temporarily_unavailable/);
});

test("ログアウトはserver actionでentryへ遷移する", () => {
  assert.match(authIndex, /handlers,\s*auth,\s*signIn,\s*signOut/);
  assert.match(authSignOut, /"use server"/);
  assert.match(authSignOut, /signOut\(\{ redirectTo: "\/entry" \}\)/);
});

test("auth completeはopen redirectと循環を拒否する", async () => {
  const { sanitizeAuthCompleteNext, buildAuthCompleteHref } = await import(
    "./authComplete.ts"
  );
  assert.equal(sanitizeAuthCompleteNext("https://evil.example"), "/dashboard");
  assert.equal(sanitizeAuthCompleteNext("//evil.example"), "/dashboard");
  assert.equal(sanitizeAuthCompleteNext("/auth/complete?next=/dashboard"), "/dashboard");
  assert.equal(sanitizeAuthCompleteNext("/api/auth/callback/discord"), "/dashboard");
  assert.equal(sanitizeAuthCompleteNext("/onboarding?next=/dashboard"), "/dashboard");
  assert.equal(sanitizeAuthCompleteNext("/rules"), "/dashboard");
  assert.match(buildAuthCompleteHref("/dashboard"), /^\/auth\/complete\?next=/);
});

test("auth complete page の next フォールバックは /dashboard", () => {
  assert.match(
    completePage,
    /sanitizeAuthCompleteNext\(\s*firstSearchParamValue\(params\?\.next\),\s*"\/dashboard",\s*\)/,
  );
});

test("entryはAuth.js error codeを安全に表示する", () => {
  assert.match(entryPage, /AccessDenied/);
  assert.match(entryPage, /OAuthCallback/);
  assert.match(entryPage, /OAuthCallbackError/);
  assert.match(entryPage, /AccountNotLinked/);
  assert.match(entryPage, /OAuthAccountNotLinked/);
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

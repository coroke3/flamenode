import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import {
  AUTH_BASELINE_ENV, BASELINE_COOKIES, SESSIONS,
} from "../../../src/lib/auth/authBaseline.fixture.mjs";

process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(
  new URL("../../../tsconfig.json", import.meta.url),
);

if (runTestWithTsx(import.meta.url)) {
  const { createHarness, authRequest, setCookies } = await loadAuthBaseline();
  const {
    AUTH_COMPLETE_RETRY_DELAYS_MS,
    resolveUnmountedAuthCompleteSession,
    unmountedAuthCompleteDestination,
  } = await import("../src/auth/complete.ts");
  const { createUnmountedAuthCompleteRoutes } =
    await import("../src/routes/authComplete.ts");
  const {
    AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS,
    resolveAuthCompleteSession,
  } = await import("../../../src/lib/auth/authComplete.ts");

  const noWait = async () => {};
  const origin = AUTH_BASELINE_ENV.AUTH_URL;
  const locationPath = (response) => {
    const href = response.headers.get("location");
    assert.ok(href, "redirect must provide Location");
    const target = new URL(href, origin);
    assert.equal(target.origin, origin, "redirect cannot escape configured origin");
    return target.pathname + target.search + target.hash;
  };
  // Auth-complete's 303 is derived from Cookie/session/ban state, unlike a static redirect.
  // A cache must never reuse the location for a different authenticated user.
  const assertUncachedAuthRedirect = (response) => {
    assert.match(response.headers.get("cache-control") ?? "", /\bno-store\b/i);
    assert.match(response.headers.get("vary") ?? "", /(?:^|,)\s*cookie\s*(?:,|$)/i);
  };
  const input = (d1) => ({
    d1,
    authSecret: AUTH_BASELINE_ENV.AUTH_SECRET,
    discordClientId: AUTH_BASELINE_ENV.AUTH_DISCORD_ID,
    discordClientSecret: AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET,
    authOrigin: origin,
    siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
  });

  test("U03a: delayed session replay matches CURRENT exact retry/read contract", async () => {
    assert.deepEqual(AUTH_COMPLETE_RETRY_DELAYS_MS, AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS);
    function source() {
      let attempts = 0;
      return async () => {
        attempts++;
        if (attempts === 1) return null;
        if (attempts === 2) throw new Error("transient session failure");
        return { user: { id: "synthetic-user", is_banned: 0 } };
      };
    }
    const actualWaits = [];
    const currentWaits = [];
    const actual = await resolveUnmountedAuthCompleteSession(
      source(), async (ms) => { actualWaits.push(ms); },
    );
    const current = await resolveAuthCompleteSession(
      source(), async (ms) => { currentWaits.push(ms); },
    );
    assert.deepEqual(actual, current);
    assert.deepEqual(actualWaits, [80, 160]);
    assert.deepEqual(currentWaits, actualWaits);
  });

  test("U03a: missing and transient failure outcomes match CURRENT after four reads", async () => {
    for (const [kind, source] of [
      ["missing", async () => null],
      ["unavailable", async () => { throw new Error("synthetic D1 unavailable"); }],
    ]) {
      let reads = 0;
      let legacyReads = 0;
      const actual = await resolveUnmountedAuthCompleteSession(async () => {
        reads++;
        return source();
      }, noWait);
      const current = await resolveAuthCompleteSession(async () => {
        legacyReads++;
        return source();
      }, noWait);
      assert.deepEqual(actual, current);
      assert.equal(actual.kind, kind);
      assert.equal(actual.attempts, 4);
      assert.equal(reads, 4);
      assert.equal(legacyReads, 4);
    }
  });

  test("U03a: real D1 valid session redirects only to safe same-site destination", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthCompleteRoutes(input(d1), noWait);
    const token = SESSIONS.valid.sessionToken;
    const cookie = BASELINE_COOKIES.sessionToken.name + "=" + token;
    const response = await app.request(origin + "/auth/complete?next=%2Fmanage%2Fevents%3Ftab%3D1", {
      headers: { cookie, host: "attacker.invalid", "x-forwarded-host": "attacker.invalid" },
    });
    assert.equal(response.status, 303);
    assertUncachedAuthRedirect(response);
    assert.equal(locationPath(response), "/manage/events?tab=1");
    const refreshed = setCookies(response)[BASELINE_COOKIES.sessionToken.name];
    assert.equal(refreshed?.value, token,
      "the internal Auth.js session-renewal cookie must survive the outer 303");
    const { expires, ...attributes } = refreshed.attributes;
    assert.deepEqual({ attributes, hasExpires: expires !== undefined },
      BASELINE_COOKIES.sessionToken.observedOnRead);
    // A cookie delivered by /auth/complete remains legible to CURRENT NextAuth.
    const current = await authRequest("session", {
      cookieHeader: BASELINE_COOKIES.sessionToken.name + "=" + refreshed.value,
    });
    assert.equal(current.status, 200);
    assert.equal((await current.json())?.user?.id, "user-mock-valid");
  });

  test("U03a: banned and missing sessions never redirect to requested protected path", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthCompleteRoutes(input(d1), noWait);
    for (const [token, expected] of [
      [SESSIONS.banned.sessionToken, "/entry?error=AccessDenied"],
      [SESSIONS.deletedToken, "/entry"],
    ]) {
      const response = await app.request(origin + "/auth/complete?next=%2Fdashboard", {
        headers: { cookie: BASELINE_COOKIES.sessionToken.name + "=" + token },
      });
      assert.equal(response.status, 303);
      assertUncachedAuthRedirect(response);
      assert.equal(locationPath(response), expected);
    }
  });

  test("U03a: malicious and looping next paths fall back to dashboard", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthCompleteRoutes(input(d1), noWait);
    const cookie = BASELINE_COOKIES.sessionToken.name + "=" + SESSIONS.valid.sessionToken;
    for (const candidate of [
      "https://attacker.example/x", "//attacker.example",
      "/api/auth/callback/discord", "/auth/complete?next=/dashboard",
      "/onboarding", "/%61pi/auth", "/foo/../auth/complete",
    ]) {
      const response = await app.request(origin + "/auth/complete?next=" + encodeURIComponent(candidate), {
        headers: { cookie },
      });
      assert.equal(response.status, 303);
      assertUncachedAuthRedirect(response);
      assert.equal(locationPath(response), "/dashboard", candidate);
    }
  });

  test("U03a: failed origin config and read failures only navigate to retryable error", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthCompleteRoutes(
      { ...input(d1), authOrigin: "https://attacker.example/" },
      noWait,
    );
    const response = await app.request(origin + "/auth/complete?next=%2Fdashboard", {
      headers: { cookie: BASELINE_COOKIES.sessionToken.name + "=" + SESSIONS.valid.sessionToken },
    });
    assert.equal(response.status, 303);
    assertUncachedAuthRedirect(response);
    assert.equal(locationPath(response), "/entry?error=auth_temporarily_unavailable");
    assert.equal(response.headers.getSetCookie().length, 0,
      "a failed session read must not forward partial authentication cookies");
    assert.equal(unmountedAuthCompleteDestination({ kind: "unavailable", attempts: 4 }, "/dashboard"),
      "/entry?error=auth_temporarily_unavailable");
  });

  test("U03a: auth completion route is test-only and cannot perform OAuth actions", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthCompleteRoutes(input(d1), noWait);
    const response = await app.request(origin + "/api/auth/signin/discord");
    assert.equal(response.status, 404);
    const post = await app.request(origin + "/auth/complete", { method: "POST" });
    assert.equal(post.status, 404);
    const deployedApp = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
    assert.doesNotMatch(deployedApp, /authCompleteRoutes|createUnmountedAuthCompleteRoutes/);
  });
}

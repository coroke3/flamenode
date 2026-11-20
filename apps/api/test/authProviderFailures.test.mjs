/** SEC-0804-01 / Issue #694: synthetic unmounted Auth.js D1 fault regression.
 * This suite uses local SQLite fixtures only. Never touches production routes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import { AUTH_BASELINE_ENV, BASELINE_COOKIES, SESSIONS, USERS } from "../../../src/lib/auth/authBaseline.fixture.mjs";

process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));

if (runTestWithTsx(import.meta.url)) {
  const { createHarness } = await loadAuthBaseline();
  const { createUnmountedAuthRoutes } = await import("../src/routes/auth.ts");
  const ORIGIN = AUTH_BASELINE_ENV.AUTH_URL;
  const SENTINEL = "SEC_0804_PRIVATE_D1_EXCEPTION_DO_NOT_DISCLOSE";

  function inputs(d1) {
    return {
      d1,
      authSecret: AUTH_BASELINE_ENV.AUTH_SECRET,
      discordClientId: AUTH_BASELINE_ENV.AUTH_DISCORD_ID,
      discordClientSecret: AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET,
      authOrigin: ORIGIN,
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    };
  }
  const cookie = (token) => `${BASELINE_COOKIES.sessionToken.name}=${token}`;
  const sessionRequest = (app, token) => app.request(`${ORIGIN}/api/auth/session`, {
    headers: { cookie: cookie(token) },
  });

  function brokenD1(d1, at) {
    // Preserve all other methods, including batch(); simulate throwing native
    // D1 prepare or a rejected statement execution after config initialization.
    return {
      ...d1,
      prepare(sql) {
        if (at === "prepare") throw new Error(SENTINEL);
        const statement = d1.prepare(sql);
        return {
          ...statement,
          bind(...args) {
            const bound = statement.bind(...args);
            return {
              ...bound,
              first: async (...rest) => {
                if (at === "read") throw new Error(SENTINEL);
                return bound.first(...rest);
              },
              all: async (...rest) => {
                if (at === "read") throw new Error(SENTINEL);
                return bound.all(...rest);
              },
            };
          },
        };
      },
    };
  }

  async function assertUnavailable(response) {
    assert.equal(response.status, 503, "a database outage must not masquerade as logged-out 200");
    assert.match(response.headers.get("cache-control") ?? "", /\bprivate\b/i);
    assert.match(response.headers.get("cache-control") ?? "", /\bno-store\b/i);
    assert.equal(response.headers.get("set-cookie"), null, "do not rotate/revoke a cookie on outage");
    const body = await response.text();
    assert.equal(body, '{"error":"auth_temporarily_unavailable"}');
    assert.doesNotMatch(body, /SEC_0804|AdapterError|SessionTokenError|secret/i);
  }

  for (const mode of ["prepare", "read"]) {
    test(`SEC-0804-01: D1 ${mode} failure returns private 503 and preserves session row`, async (t) => {
      const { d1, sqlite } = createHarness(t);
      const app = createUnmountedAuthRoutes(inputs(brokenD1(d1, mode)));
      const before = sqlite.prepare('SELECT "sessionToken" FROM "session" WHERE "sessionToken" = ?')
        .get(SESSIONS.valid.sessionToken);
      assert.ok(before);
      const result = await sessionRequest(app, SESSIONS.valid.sessionToken);
      await assertUnavailable(result);
      const after = sqlite.prepare('SELECT "sessionToken" FROM "session" WHERE "sessionToken" = ?')
        .get(SESSIONS.valid.sessionToken);
      assert.deepEqual(after, before, "provider outage must not revoke existing D1 session");
    });
  }

  test("SEC-0804-01: missing, unknown and expired sessions still return ordinary 200 null", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthRoutes(inputs(d1));
    for (const token of [SESSIONS.deletedToken, SESSIONS.expired.sessionToken]) {
      const res = await sessionRequest(app, token);
      assert.equal(res.status, 200);
      assert.equal(await res.json(), null);
    }
    const withoutCookie = await app.request(`${ORIGIN}/api/auth/session`);
    assert.equal(withoutCookie.status, 200);
    assert.equal(await withoutCookie.json(), null);
  });

  test("SEC-0804-01: a D1 outage in one request does not poison a concurrent healthy session", async (t) => {
    const { d1 } = createHarness(t);
    const brokenApp = createUnmountedAuthRoutes(inputs(brokenD1(d1, "read")));
    const healthyApp = createUnmountedAuthRoutes(inputs(d1));
    const [failed, healthy] = await Promise.all([
      sessionRequest(brokenApp, SESSIONS.valid.sessionToken),
      sessionRequest(healthyApp, SESSIONS.valid.sessionToken),
    ]);
    await assertUnavailable(failed);
    assert.equal(healthy.status, 200);
    const body = await healthy.json();
    assert.equal(body.user.id, USERS.valid.id);
  });
}

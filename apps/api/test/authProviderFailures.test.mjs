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
        const operation = String(sql).toLowerCase().replace(/["`]/g, "");
        const blockedWrite = (at === "update" && /^\s*update\s+session\b/.test(operation)) ||
          (at === "delete" && /^\s*delete\s+from\s+session\b/.test(operation));
        return {
          ...statement,
          bind(...args) {
            const bound = statement.bind(...args);
            const fail = () => at === "read" || blockedWrite;
            return {
              ...bound,
              first: async (...rest) => {
                if (fail()) throw new Error(SENTINEL);
                return bound.first(...rest);
              },
              all: async (...rest) => {
                if (fail()) throw new Error(SENTINEL);
                return bound.all(...rest);
              },
              run: async (...rest) => {
                if (fail()) throw new Error(SENTINEL);
                return bound.run(...rest);
              },
              // Drizzle's D1 driver selects through raw(), not only all()/first().
              raw: async (...rest) => {
                if (fail()) throw new Error(SENTINEL);
                return bound.raw(...rest);
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

  test("SEC-0804-01: session sliding-update failure is unavailable, not a successful renewal", async (t) => {
    const { d1, sqlite } = createHarness(t);
    const nearExpiry = Date.now() + 2 * 86_400_000;
    sqlite.prepare('UPDATE "session" SET expires = ? WHERE "sessionToken" = ?')
      .run(nearExpiry, SESSIONS.valid.sessionToken);
    const app = createUnmountedAuthRoutes(inputs(brokenD1(d1, "update")));
    await assertUnavailable(await sessionRequest(app, SESSIONS.valid.sessionToken));
    const stored = sqlite.prepare('SELECT expires FROM "session" WHERE "sessionToken" = ?')
      .get(SESSIONS.valid.sessionToken);
    assert.equal(stored.expires, nearExpiry, "failed renewal must not mutate the D1 expiry");
  });

  test("SEC-0804-01: failed signout deletion keeps D1 session and returns private 503", async (t) => {
    const { d1, sqlite } = createHarness(t);
    const app = createUnmountedAuthRoutes(inputs(brokenD1(d1, "delete")));
    const csrf = await app.request(`${ORIGIN}/api/auth/csrf`);
    assert.equal(csrf.status, 200);
    const { csrfToken } = await csrf.json();
    const cookieName = BASELINE_COOKIES.csrfToken.name;
    const line = csrf.headers.getSetCookie().find((value) => value.startsWith(cookieName + "="));
    assert.ok(line && csrfToken, "must obtain a real Auth.js CSRF token and cookie");
    const csrfCookie = line.slice(cookieName.length + 1).split(";")[0];
    const response = await app.request(`${ORIGIN}/api/auth/signout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${cookie(SESSIONS.valid.sessionToken)}; ${cookieName}=${csrfCookie}`,
      },
      body: new URLSearchParams({ csrfToken }),
    });
    await assertUnavailable(response);
    const stored = sqlite.prepare('SELECT "sessionToken" FROM "session" WHERE "sessionToken" = ?')
      .get(SESSIONS.valid.sessionToken);
    assert.ok(stored, "a rejected delete must not silently log out the user");
  });

  test("SEC-0804-01: one Hono router isolates concurrent failed and healthy sessions", async (t) => {
    const { d1, sqlite } = createHarness(t);
    let rejectedReads = 0;
    // The same D1 binding and the same Hono app serve both requests. Only the
    // selected session fails at the bound statement boundary; another valid
    // session must not inherit its adapter error or become logged out.
    const scopedFailureD1 = {
      ...d1,
      prepare(sql) {
        const statement = d1.prepare(sql);
        return {
          ...statement,
          bind(...params) {
            const bound = statement.bind(...params);
            if (!params.includes(SESSIONS.valid.sessionToken)) return bound;
            const fail = async () => {
              rejectedReads += 1;
              await Promise.resolve(); // allow the other request to interleave
              throw new Error(SENTINEL);
            };
            return { ...bound, first: fail, all: fail, raw: fail, run: fail };
          },
        };
      },
    };
    const app = createUnmountedAuthRoutes(inputs(scopedFailureD1));
    const [failed, healthy] = await Promise.all([
      sessionRequest(app, SESSIONS.valid.sessionToken),
      sessionRequest(app, SESSIONS.noX.sessionToken),
    ]);
    assert.ok(rejectedReads > 0, "the failing request must reach a bound D1 operation");
    await assertUnavailable(failed);
    assert.equal(healthy.status, 200);
    const body = await healthy.json();
    assert.equal(body?.user?.id, USERS.noX.id);
    const afterFailure = await sessionRequest(app, SESSIONS.noX.sessionToken);
    assert.equal(afterFailure.status, 200, "later requests must not inherit failure state");
    assert.equal((await afterFailure.json())?.user?.id, USERS.noX.id);
    for (const token of [SESSIONS.valid.sessionToken, SESSIONS.noX.sessionToken]) {
      const stored = sqlite.prepare('SELECT "sessionToken" FROM "session" WHERE "sessionToken" = ?').get(token);
      assert.ok(stored, "neither failed nor healthy read may delete the D1 session");
    }
  });
}

/** MIG-0804 U02: unmounted @auth/core security regression; synthetic SQLite only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import {
  AUTH_BASELINE_ENV, BASELINE_COOKIES, SESSIONS,
} from "../../../src/lib/auth/authBaseline.fixture.mjs";

process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));

if (runTestWithTsx(import.meta.url)) {
  const { createHarness, setCookies } = await loadAuthBaseline();
  const { buildUnmountedAuthConfig } = await import("../src/auth/authjs.ts");
  const { createUnmountedAuthRoutes } = await import("../src/routes/auth.ts");
  const { createUnmountedAuthCompleteRoutes } = await import("../src/routes/authComplete.ts");

  const origin = AUTH_BASELINE_ENV.AUTH_URL;
  function credentials(d1) {
    return {
      d1,
      authSecret: AUTH_BASELINE_ENV.AUTH_SECRET,
      discordClientId: AUTH_BASELINE_ENV.AUTH_DISCORD_ID,
      discordClientSecret: AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET,
      authOrigin: origin,
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    };
  }

  test("MIG-0804 U02 T01: Auth.js redirect callback rejects external origins and unsafe schemes", async (t) => {
    const { d1 } = createHarness(t);
    const callback = buildUnmountedAuthConfig(credentials(d1)).callbacks.redirect;
    assert.equal(typeof callback, "function");
    for (const input of [
      "https://evil.example/path",
      "https://flamenode.example.evil.example/path",
      "javascript:alert(1)",
      "data:text/html,evil",
      "https://evil.example@attacker.invalid/path",
    ]) {
      const target = await callback({ url: input, baseUrl: origin });
      assert.equal(target, origin + "/dashboard", input);
    }
    // A protocol-relative string is interpreted by this CURRENT callback as
    // a path on the *configured* origin; it must never become an external host.
    const doubleSlash = await callback({ url: "//attacker.invalid/path", baseUrl: origin });
    assert.equal(new URL(doubleSlash).origin, origin);
    assert.equal(await callback({ url: "/dashboard?next=%2Fabout", baseUrl: origin }),
      origin + "/dashboard?next=%2Fabout");
  });

  test("MIG-0804 U02 T02: spoofed Host headers cannot redirect or set cookies for another origin", async (t) => {
    async function readSession(extraHeaders = {}) {
      // Separate identical fixtures keep sliding renewal from changing the baseline.
      const { d1 } = createHarness(t);
      const app = createUnmountedAuthRoutes(credentials(d1));
      const res = await app.request(origin + "/api/auth/session", {
        headers: {
          cookie: BASELINE_COOKIES.sessionToken.name + "=" + SESSIONS.valid.sessionToken,
          ...extraHeaders,
        },
      });
      assert.equal(res.status, 200, "the valid session must actually resolve");
      const body = await res.json();
      assert.equal(body?.user?.id, SESSIONS.valid.userId);
      const redirect = res.headers.get("location");
      if (redirect) assert.equal(new URL(redirect, origin).origin, origin);
      const rawCookies = res.headers.getSetCookie().join("\n").toLowerCase();
      assert.doesNotMatch(rawCookies, /domain\s*=\s*attacker\.invalid/);
      const cookies = Object.fromEntries(Object.entries(setCookies(res)).map(([name, cookie]) => {
        const { expires, ...attributes } = cookie.attributes;
        // CSRF values and expiry timestamps vary; their presence and attributes do not.
        const value = name === BASELINE_COOKIES.csrfToken.name ? Boolean(cookie.value) : cookie.value;
        return [name, { value, attributes, hasExpires: expires !== undefined }];
      }));
      assert.deepEqual(cookies[BASELINE_COOKIES.sessionToken.name], {
        value: SESSIONS.valid.sessionToken,
        ...BASELINE_COOKIES.sessionToken.observedOnRead,
      });
      return {
        body, redirect, cookies,
        contentType: res.headers.get("content-type"),
        cacheControl: res.headers.get("cache-control"),
      };
    }
    const baseline = await readSession();
    const spoofed = await readSession({
      host: "attacker.invalid",
      "x-forwarded-host": "attacker.invalid",
    });
    assert.deepEqual(spoofed, baseline, "Host headers must not change the configured-origin contract");
  });

  test("MIG-0804 U02 T03: D1 runtime exception fails closed as private 503 (not an empty login)", async (t) => {
    const { d1 } = createHarness(t);
    const providerSentinel = "SENTINEL_AUTH_D1_PROVIDER_PRIVATE";
    const brokenD1 = {
      ...d1,
      prepare() { throw new Error(providerSentinel); },
      batch() { throw new Error(providerSentinel); },
    };
    const app = createUnmountedAuthRoutes(credentials(brokenD1));
    const res = await app.request(origin + "/api/auth/session", {
      headers: {
        cookie: BASELINE_COOKIES.sessionToken.name + "=" + SESSIONS.valid.sessionToken,
      },
    });
    const body = await res.text();
    assert.equal(res.status, 503, "a provider outage cannot be represented as a logged-out 200 session");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/i);
    assert.doesNotMatch(body, new RegExp(providerSentinel));
  });

  function countD1Statements(d1) {
    const ops = [];
    const wrapStmt = (sql, stmt) => ({
      ...stmt,
      bind(...args) {
        const bound = stmt.bind(...args);
        const record = () => {
          ops.push(String(sql).trim().split(/\s+/)[0].toUpperCase());
        };
        return {
          ...bound,
          first: async (...rest) => { record(); return bound.first(...rest); },
          all: async (...rest) => { record(); return bound.all(...rest); },
          raw: async (...rest) => { record(); return bound.raw(...rest); },
          run: async (...rest) => { record(); return bound.run(...rest); },
        };
      },
    });
    return {
      ops,
      d1: {
        ...d1,
        prepare: (sql) => wrapStmt(sql, d1.prepare(sql)),
        batch: async (list) => {
          ops.push("BATCH");
          return d1.batch(list);
        },
      },
    };
  }

  test("MIG-0804 U01: per-request D1 query counts across session, csrf, signout, and complete", async (t) => {
    const cookieName = BASELINE_COOKIES.sessionToken.name;
    const csrfName = BASELINE_COOKIES.csrfToken.name;
    const validCookie = `${cookieName}=${SESSIONS.valid.sessionToken}`;

    async function measure(fn) {
      const { d1, sqlite } = createHarness(t);
      const tracked = countD1Statements(d1);
      const res = await fn(tracked.d1, sqlite);
      return { status: res.status, ops: tracked.ops };
    }

    assert.deepEqual(
      await measure((d1) => createUnmountedAuthRoutes(credentials(d1)).request(`${origin}/api/auth/session`)),
      { status: 200, ops: [] },
    );
    assert.deepEqual(
      await measure((d1) => createUnmountedAuthRoutes(credentials(d1)).request(`${origin}/api/auth/session`, {
        headers: { cookie: `${cookieName}=${SESSIONS.deletedToken}` },
      })),
      { status: 200, ops: ["SELECT"] },
    );
    assert.deepEqual(
      await measure((d1) => createUnmountedAuthRoutes(credentials(d1)).request(`${origin}/api/auth/session`, {
        headers: { cookie: `${cookieName}=${SESSIONS.expired.sessionToken}` },
      })),
      { status: 200, ops: ["SELECT", "DELETE"] },
    );
    assert.deepEqual(
      await measure((d1, sqlite) => {
        sqlite.prepare('UPDATE "session" SET expires = ? WHERE "sessionToken" = ?')
          .run(Date.now() + 29.9 * 86_400_000, SESSIONS.valid.sessionToken);
        return createUnmountedAuthRoutes(credentials(d1)).request(`${origin}/api/auth/session`, {
          headers: { cookie: validCookie },
        });
      }),
      { status: 200, ops: ["SELECT"] },
    );
    assert.deepEqual(
      await measure((d1, sqlite) => {
        sqlite.prepare('UPDATE "session" SET expires = ? WHERE "sessionToken" = ?')
          .run(Date.now() + 2 * 86_400_000, SESSIONS.valid.sessionToken);
        return createUnmountedAuthRoutes(credentials(d1)).request(`${origin}/api/auth/session`, {
          headers: { cookie: validCookie },
        });
      }),
      { status: 200, ops: ["SELECT", "UPDATE"] },
    );
    assert.deepEqual(
      await measure((d1) => createUnmountedAuthRoutes(credentials(d1)).request(`${origin}/api/auth/csrf`)),
      { status: 200, ops: [] },
    );
    assert.deepEqual(
      await measure(async (d1) => {
        const app = createUnmountedAuthRoutes(credentials(d1));
        const csrf = await app.request(`${origin}/api/auth/csrf`);
        const csrfCookie = setCookies(csrf)[csrfName]?.value;
        return app.request(`${origin}/api/auth/signout`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: `${validCookie}; ${csrfName}=${csrfCookie}`,
          },
          body: new URLSearchParams({ csrfToken: "invalid-csrf-token" }),
        });
      }),
      { status: 302, ops: [] },
    );
    assert.deepEqual(
      await measure(async (d1) => {
        const app = createUnmountedAuthRoutes(credentials(d1));
        const csrf = await app.request(`${origin}/api/auth/csrf`);
        const { csrfToken } = await csrf.json();
        const csrfCookie = setCookies(csrf)[csrfName]?.value;
        return app.request(`${origin}/api/auth/signout`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: `${validCookie}; ${csrfName}=${csrfCookie}`,
          },
          body: new URLSearchParams({ csrfToken }),
        });
      }),
      { status: 302, ops: ["DELETE"] },
    );
    assert.deepEqual(
      await measure((d1, sqlite) => {
        sqlite.prepare('UPDATE "session" SET expires = ? WHERE "sessionToken" = ?')
          .run(Date.now() + 29.9 * 86_400_000, SESSIONS.valid.sessionToken);
        return createUnmountedAuthCompleteRoutes(credentials(d1), async () => {}).request(
          `${origin}/auth/complete?next=%2Fdashboard`,
          { headers: { cookie: validCookie } },
        );
      }),
      { status: 303, ops: ["SELECT"] },
    );
    assert.deepEqual(
      await measure((d1) => createUnmountedAuthCompleteRoutes(credentials(d1), async () => {}).request(
        `${origin}/auth/complete?next=%2Fdashboard`,
        { headers: { cookie: `${cookieName}=${SESSIONS.deletedToken}` } },
      )),
      { status: 303, ops: ["SELECT", "SELECT", "SELECT", "SELECT"] },
    );
  });
}

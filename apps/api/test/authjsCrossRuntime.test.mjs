import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import {
  AUTH_BASELINE_ENV, BASELINE_COOKIES, SESSIONS, USERS,
} from "../../../src/lib/auth/authBaseline.fixture.mjs";

// CURRENT harness imports the root NextAuth bridge. Run under root aliases.
process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(
  new URL("../../../tsconfig.json", import.meta.url),
);

if (runTestWithTsx(import.meta.url)) {
  const { createHarness, authRequest, setCookies } = await loadAuthBaseline();
  const { buildUnmountedAuthConfig } = await import("../src/auth/authjs.ts");
  const { createUnmountedAuthRoutes } = await import("../src/routes/auth.ts");

  function input(d1) {
    return {
      d1,
      authSecret: AUTH_BASELINE_ENV.AUTH_SECRET,
      discordClientId: AUTH_BASELINE_ENV.AUTH_DISCORD_ID,
      discordClientSecret: AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET,
      authOrigin: AUTH_BASELINE_ENV.AUTH_URL,
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    };
  }
  function withoutVolatile(cookie) {
    if (!cookie) return null;
    const { expires, ...attributes } = cookie.attributes;
    return { attributes, hasExpires: expires !== undefined };
  }

  test("U01: unmounted Hono/Auth.js resolves the CURRENT valid D1 session and cookie", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthRoutes(input(d1));
    const cookie = `${BASELINE_COOKIES.sessionToken.name}=${SESSIONS.valid.sessionToken}`;
    const response = await app.request(`${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/session`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.id, USERS.valid.id);
    assert.equal(body.user.role, USERS.valid.role);
    assert.equal(body.user.is_banned, USERS.valid.is_banned);
    assert.equal(body.user.active_x_user_id, USERS.valid.active_x_user_id);
    assert.deepEqual(
      withoutVolatile(setCookies(response)[BASELINE_COOKIES.sessionToken.name]),
      BASELINE_COOKIES.sessionToken.observedOnRead,
    );
  });

  test("U01: Hono/Auth.js CSRF cookie name and attributes match CURRENT", async (t) => {
    const { d1 } = createHarness(t);
    const target = await createUnmountedAuthRoutes(input(d1)).request(
      `${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/csrf`,
    );
    assert.equal(target.status, 200);
    const csrf = await target.json();
    assert.equal(typeof csrf.csrfToken, "string");
    assert.deepEqual(
      withoutVolatile(setCookies(target)[BASELINE_COOKIES.csrfToken.name]),
      BASELINE_COOKIES.csrfToken.observed,
    );
    // CURRENT must still generate the same cookie contract.
    const current = await authRequest("csrf");
    assert.deepEqual(
      withoutVolatile(setCookies(target)[BASELINE_COOKIES.csrfToken.name]),
      withoutVolatile(setCookies(current)[BASELINE_COOKIES.csrfToken.name]),
    );
  });

  test("U01: unknown session is not an authenticated user", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthRoutes(input(d1));
    const response = await app.request(`${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/session`, {
      headers: { cookie: `${BASELINE_COOKIES.sessionToken.name}=${SESSIONS.deletedToken}` },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.json(), null);
  });

  test("U01: sign-in and sign-out are not mounted during this PoC", async (t) => {
    const { d1, sqlite } = createHarness(t);
    const app = createUnmountedAuthRoutes(input(d1));
    for (const path of ["signin/discord", "callback/discord", "signout"]) {
      for (const method of ["GET", "POST"]) {
        const response = await app.request(`${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/${path}`, { method });
        assert.equal(response.status, 404, `${method} ${path} must remain unavailable`);
      }
    }
    const row = sqlite.prepare('SELECT "sessionToken" FROM "session" WHERE "sessionToken" = ?')
      .get(SESSIONS.valid.sessionToken);
    assert.equal(row.sessionToken, SESSIONS.valid.sessionToken);
  });

  test("U01: atomic account-link port is required; ordinary Drizzle link is refused", async (t) => {
    const { d1, sqlite } = createHarness(t);
    const config = buildUnmountedAuthConfig(input(d1));
    const before = sqlite.prepare('SELECT COUNT(*) AS n FROM "account"').get().n;
    await assert.rejects(config.adapter.linkAccount({
      userId: USERS.valid.id,
      type: "oauth",
      provider: "discord",
      providerAccountId: "synthetic_unlinked",
    }), /AUTH_ATOMIC_LINK_PORT_PENDING/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM "account"').get().n, before);
  });


  // U02a tests only session READ + sliding renewal. Hono still cannot issue
  // a new login session, sign out, or link an OAuth account in this PoC.
  function sessionClaims(body) {
    return body?.user ? {
      id: body.user.id,
      role: body.user.role,
      is_banned: body.user.is_banned,
      active_x_user_id: body.user.active_x_user_id,
    } : null;
  }

  test("U02a: CURRENT renewed session cookie is readable by unmounted Hono/Auth.js", async (t) => {
    const { d1 } = createHarness(t);
    const name = BASELINE_COOKIES.sessionToken.name;
    const legacy = await authRequest("session", {
      cookies: { [name]: SESSIONS.valid.sessionToken },
    });
    assert.equal(legacy.status, 200);
    const legacyClaims = sessionClaims(await legacy.json());
    assert.equal(legacyClaims.id, USERS.valid.id);
    const renewed = setCookies(legacy)[name];
    assert.equal(renewed?.value, SESSIONS.valid.sessionToken);
    assert.deepEqual(withoutVolatile(renewed), BASELINE_COOKIES.sessionToken.observedOnRead);

    const target = await createUnmountedAuthRoutes(input(d1)).request(
      `${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/session`, {
        headers: { cookie: `${name}=${renewed.value}` },
      },
    );
    assert.equal(target.status, 200);
    assert.deepEqual(sessionClaims(await target.json()), legacyClaims);
    assert.equal(setCookies(target)[name]?.value, SESSIONS.valid.sessionToken,
      "reading the legacy renewal must not mint a different session token");
  });

  test("U02a: Hono/Auth.js renewed session cookie is readable by CURRENT NextAuth", async (t) => {
    const { d1 } = createHarness(t);
    const name = BASELINE_COOKIES.sessionToken.name;
    const target = await createUnmountedAuthRoutes(input(d1)).request(
      `${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/session`, {
        headers: { cookie: `${name}=${SESSIONS.valid.sessionToken}` },
      },
    );
    assert.equal(target.status, 200);
    const targetClaims = sessionClaims(await target.json());
    const renewed = setCookies(target)[name];
    assert.equal(renewed?.value, SESSIONS.valid.sessionToken);
    assert.deepEqual(withoutVolatile(renewed), BASELINE_COOKIES.sessionToken.observedOnRead);

    const current = await authRequest("session", {
      cookieHeader: `${name}=${renewed.value}`,
    });
    assert.equal(current.status, 200);
    assert.deepEqual(sessionClaims(await current.json()), targetClaims);
    assert.equal(targetClaims.id, USERS.valid.id);
    assert.equal(setCookies(current)[name]?.value, SESSIONS.valid.sessionToken);
  });

  for (const [scenario, token, userId, isBanned] of [
    ["banned", SESSIONS.banned.sessionToken, USERS.banned.id, 1],
    ["expired", SESSIONS.expired.sessionToken, null, null],
    ["deleted", SESSIONS.deletedToken, null, null],
  ]) {
    test(`U02a: ${scenario} session resolves consistently in both runtimes`, async (t) => {
      const { d1 } = createHarness(t);
      const name = BASELINE_COOKIES.sessionToken.name;
      const cookieHeader = `${name}=${token}`;
      const target = await createUnmountedAuthRoutes(input(d1)).request(
        `${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/session`, {
          headers: { cookie: cookieHeader },
        },
      );
      const current = await authRequest("session", { cookieHeader });
      assert.equal(target.status, 200);
      assert.equal(current.status, 200);
      assert.deepEqual(sessionClaims(await target.json()), sessionClaims(await current.json()));
      const targetCookie = setCookies(target)[name];
      const currentCookie = setCookies(current)[name];
      assert.deepEqual(withoutVolatile(targetCookie), withoutVolatile(currentCookie));
      const result = sessionClaims(userId ? {
        user: { id: userId, role: "user", is_banned: isBanned, active_x_user_id: null },
      } : null);
      const actual = sessionClaims(await authRequest("session", { cookieHeader }).then(r => r.json()));
      assert.deepEqual(actual, result);
    });
  }

  test("U02a: CURRENT logout revokes D1 session so unmounted Hono rejects old cookie", async (t) => {
    const { d1, sqlite } = createHarness(t);
    const sessionName = BASELINE_COOKIES.sessionToken.name;
    const csrfName = BASELINE_COOKIES.csrfToken.name;
    const csrfResponse = await authRequest("csrf");
    const { csrfToken } = await csrfResponse.json();
    const csrfCookie = setCookies(csrfResponse)[csrfName];
    assert.ok(csrfToken && csrfCookie?.value);
    const signout = await authRequest("signout", {
      method: "POST",
      cookies: {
        [sessionName]: SESSIONS.valid.sessionToken,
        [csrfName]: csrfCookie.value,
      },
      body: { csrfToken },
    });
    assert.equal(setCookies(signout)[sessionName]?.value, "");
    assert.equal(sqlite.prepare(
      'SELECT "sessionToken" FROM "session" WHERE "sessionToken" = ?',
    ).get(SESSIONS.valid.sessionToken), undefined);

    const after = await createUnmountedAuthRoutes(input(d1)).request(
      `${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/session`, {
        headers: { cookie: `${sessionName}=${SESSIONS.valid.sessionToken}` },
      },
    );
    assert.equal(after.status, 200);
    assert.equal(await after.json(), null,
      "revocation in legacy runtime must invalidate auth in the target runtime");
  });

  test("U01: explicit HTTPS origin, configured origin match and secret fail closed", async (t) => {
    const { d1 } = createHarness(t);
    const base = input(d1);
    assert.throws(() => buildUnmountedAuthConfig({ ...base, authSecret: "" }), /AUTH_SECRET_MISSING/);
    assert.throws(() => buildUnmountedAuthConfig({
      ...base, authOrigin: "https://attacker.example",
    }), /AUTH_ORIGIN_MISMATCH/);
    for (const authOrigin of [
      "https://flamenode.example/path",
      "http://flamenode.example",
      "https://user:pass@flamenode.example",
      "https://flamenode.example?x=1",
    ]) {
      assert.throws(() => buildUnmountedAuthConfig({
        ...base, authOrigin,
      }), /AUTH_ORIGIN_INVALID/);
    }
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import { SESSIONS, USERS } from "../../../src/lib/auth/authBaseline.fixture.mjs";

// MIG-0608 T01-T04 against CURRENT: the same Cookie header goes to the real
// Auth.js (buildAuthConfig + @auth/core) and to the Hono reader on the same D1.
// Both must resolve the same user id (or nobody).
// CURRENT auth code uses the root tsconfig's `@/` paths, also when this runs
// from apps/api (npm run test --workspace=@flamenode/api).
process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));

if (runTestWithTsx(import.meta.url)) {
  const { createHarness, authRequest } = await loadAuthBaseline();
  const { extractSessionToken, resolveSessionUser, sessionMiddleware, requireAuth } =
    await import("../src/auth/session.ts");

  const SECURE = "__Secure-authjs.session-token";

  async function nextUserId(cookieHeader) {
    const response = await authRequest("session", { cookieHeader });
    const body = await response.json();
    return { id: body?.user?.id ?? null, isBanned: body?.user?.is_banned ?? null };
  }

  async function honoUserId(d1, cookieHeader) {
    const token = extractSessionToken(cookieHeader, { secure: true });
    const user = await resolveSessionUser(d1, token);
    return { id: user?.id ?? null, isBanned: user?.is_banned ?? null };
  }

  const cases = [
    ["valid __Secure- cookie", `${SECURE}=${SESSIONS.valid.sessionToken}`, USERS.valid.id],
    ["expired session", `${SECURE}=${SESSIONS.expired.sessionToken}`, null],
    ["unknown token", `${SECURE}=${SESSIONS.deletedToken}`, null],
    ["banned user", `${SECURE}=${SESSIONS.banned.sessionToken}`, USERS.banned.id],
    ["tampered token", `${SECURE}=${SESSIONS.valid.sessionToken}x`, null],
    ["SQL in cookie", `${SECURE}=' OR '1'='1`, null],
    ["unprefixed cookie on https", `authjs.session-token=${SESSIONS.valid.sessionToken}`, null],
    ["Auth.js v4 cookie name", `__Secure-next-auth.session-token=${SESSIONS.valid.sessionToken}`, null],
    [
      "duplicated cookie, first wins",
      `${SECURE}=${SESSIONS.banned.sessionToken}; ${SECURE}=${SESSIONS.valid.sessionToken}`,
      USERS.banned.id,
    ],
    [
      "duplicated cookie, first is unknown",
      `${SECURE}=${SESSIONS.deletedToken}; ${SECURE}=${SESSIONS.valid.sessionToken}`,
      null,
    ],
  ];

  for (const [name, cookieHeader, expectedId] of cases) {
    test(`parity: ${name}`, async (t) => {
      const { d1 } = createHarness(t);
      // Hono first: Auth.js deletes an expired session row while reading it.
      const hono = await honoUserId(d1, cookieHeader);
      const next = await nextUserId(cookieHeader);
      assert.deepEqual(hono, next);
      assert.equal(hono.id, expectedId);
    });
  }

  test("T03: banned user is rejected by requireAuth with 403, like CURRENT is_banned === 1", async (t) => {
    const { d1 } = createHarness(t);
    const values = new Map();
    const context = {
      req: {
        url: "https://flamenode.example/api/me",
        header: (name) =>
          name.toLowerCase() === "cookie" ? `${SECURE}=${SESSIONS.banned.sessionToken}` : undefined,
      },
      env: { DB: d1 },
      set: (key, value) => values.set(key, value),
      get: (key) => values.get(key),
      json: (body, status) => ({ body, status }),
    };
    await sessionMiddleware()(context, async () => {});
    let reached = false;
    const response = await requireAuth()(context, async () => {
      reached = true;
    });
    assert.equal(reached, false);
    assert.equal(response.status, 403);
  });

  test("T04: a tampered cookie costs at most one D1 read", async (t) => {
    const { d1 } = createHarness(t);
    let reads = 0;
    const counted = {
      prepare(query) {
        const statement = d1.prepare(query);
        return {
          bind: (...values) => {
            const bound = statement.bind(...values);
            return {
              first: async () => {
                reads += 1;
                return bound.first();
              },
              all: async () => {
                reads += 1;
                return bound.all();
              },
            };
          },
        };
      },
    };
    await resolveSessionUser(counted, `${SESSIONS.valid.sessionToken}tampered`);
    assert.equal(reads, 1);
  });
}

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
    // Auth.js keeps quotes and joins every cookie whose name starts with the
    // session cookie name (SessionStore chunks), so these differ from a plain lookup.
    ["quoted value is not unquoted", `${SECURE}="${SESSIONS.valid.sessionToken}"`, null],
    [
      "extra .1 chunk is appended",
      `${SECURE}=${SESSIONS.valid.sessionToken}; ${SECURE}.1=zzz`,
      null,
    ],
    [
      "prefixed cookie name is appended",
      `${SECURE}=${SESSIONS.valid.sessionToken}; ${SECURE}x=zzz`,
      null,
    ],
    ["only a .0 chunk", `${SECURE}.0=${SESSIONS.valid.sessionToken}`, USERS.valid.id],
    [
      "chunks are joined by index, not header order",
      `${SECURE}.1=${SESSIONS.valid.sessionToken.slice(8)}; ${SECURE}.0=${SESSIONS.valid.sessionToken.slice(0, 8)}`,
      USERS.valid.id,
    ],
    ["empty session cookie", `${SECURE}=; ${SECURE}.1=${SESSIONS.valid.sessionToken}`, USERS.valid.id],
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

  // Token-level parity with the parser and SessionStore Auth.js actually uses
  // (not exported by @auth/core, so loaded from its file next to the entry point).
  const authCore = import.meta.resolve("@auth/core");
  const { parse } = await import(new URL("./lib/vendored/cookie.js", authCore).href);
  const { SessionStore } = await import(new URL("./lib/utils/cookie.js", authCore).href);
  const INSECURE = "authjs.session-token";
  const headers = [
    "",
    "theme=dark",
    `${SECURE}=abc`,
    `${INSECURE}=abc`,
    `${SECURE}="abc"`,
    `${SECURE}="abc`,
    `${SECURE}=a%20b%2`,
    `${SECURE}=a%62c`,
    `${SECURE}=abc; ${SECURE}.1=def`,
    `${SECURE}.1=def; ${SECURE}.0=abc`,
    `${SECURE}.2=c; ${SECURE}.10=d; ${SECURE}.1=b; ${SECURE}.0=a`,
    `${SECURE}.x=b; ${SECURE}=a; ${SECURE}.1=c`,
    `${SECURE}=abc; ${SECURE}x=zzz`,
    `${SECURE}=first; ${SECURE}=second`,
    `${SECURE}=; ${SECURE}.0=abc`,
    `${SECURE}=abc; ${INSECURE}=def`,
    `${INSECURE}=abc; ${INSECURE}.1=def; ${SECURE}=ghi`,
    `  ${SECURE} \t=\t abc \t; theme=dark`,
    `${SECURE}=\u00a0abc\u00a0`,
    `junk; ${SECURE}=abc`,
    `${SECURE}=a=b; =x; __proto__=y`,
    `${SECURE}.0=a;${SECURE}.1=b;${SECURE}.1=ignored`,
  ];
  for (const secure of [true, false]) {
    test(`token parity with Auth.js SessionStore (secure=${secure})`, () => {
      const name = secure ? SECURE : INSECURE;
      for (const header of headers) {
        const expected = new SessionStore({ name }, parse(header), console).value || null;
        assert.equal(extractSessionToken(header, { secure }), expected, header);
      }
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

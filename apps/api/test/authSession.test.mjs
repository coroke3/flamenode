import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  extractSessionToken,
  parseCookieHeader,
  resolveSessionUser,
  sessionMiddleware,
  requireAuth,
  MAX_SESSION_COOKIE_CHUNKS,
  MAX_SESSION_TOKEN_LENGTH,
  MAX_SESSION_COOKIE_NAMES,
} from "../src/auth/session.ts";
import {
  USERS,
  SESSIONS,
  BASELINE_COOKIES,
  BASELINE_NOW_MS,
} from "../../../src/lib/auth/authBaseline.fixture.mjs";

/**
 * Creates in-memory SQLite database matching the D1 baseline schema for session and user.
 */
function createTestD1() {
  const sqlite = new DatabaseSync(":memory:");

  sqlite.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      image TEXT,
      role TEXT DEFAULT 'user',
      is_banned INTEGER DEFAULT 0,
      discord_id TEXT,
      active_x_user_id TEXT
    );

    CREATE TABLE "session" (
      "sessionToken" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
  `);

  // Insert users from shared baseline fixtures
  for (const user of Object.values(USERS)) {
    sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, image, role, is_banned, discord_id, active_x_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.name,
        user.email,
        user.image ?? null,
        user.role,
        user.is_banned,
        user.discord_id,
        user.active_x_user_id,
      );
  }

  // Insert sessions from shared baseline fixtures
  for (const session of Object.values(SESSIONS)) {
    if (typeof session === "string") continue;
    sqlite
      .prepare(`INSERT INTO "session" ("sessionToken", "userId", expires) VALUES (?, ?, ?)`)
      .run(session.sessionToken, session.userId, session.expiresMs);
  }

  let queryCount = 0;

  const d1 = {
    prepare(query) {
      return {
        bind(...params) {
          return {
            first: async () => {
              queryCount++;
              const stmt = sqlite.prepare(query);
              return stmt.get(...params) ?? null;
            },
            all: async () => {
              queryCount++;
              const stmt = sqlite.prepare(query);
              return { results: stmt.all(...params) };
            },
          };
        },
      };
    },
    getQueryCount: () => queryCount,
    resetQueryCount: () => {
      queryCount = 0;
    },
    close: () => sqlite.close(),
  };

  return d1;
}

test("Cookie extraction and parsing", async (t) => {
  await t.test("parses cookies with various formats and whitespace, keeping quotes like Auth.js", () => {
    const parsed = parseCookieHeader(
      '__Secure-authjs.session-token="token-with-quotes"; theme=dark; authjs.session-token=dev-token',
    );
    assert.equal(parsed["__Secure-authjs.session-token"], '"token-with-quotes"');
    assert.equal(parsed["theme"], "dark");
    assert.equal(parsed["authjs.session-token"], "dev-token");
  });

  await t.test("https reads only the __Secure- cookie, like Auth.js useSecureCookies", () => {
    const header = "authjs.session-token=dev-token; __Secure-authjs.session-token=secure-token";
    assert.equal(extractSessionToken(header, { secure: true }), "secure-token");
    assert.equal(extractSessionToken("authjs.session-token=tossed", { secure: true }), null);
  });

  await t.test("http reads only the unprefixed cookie", () => {
    const header = "__Secure-authjs.session-token=secure-token; authjs.session-token=dev-token";
    assert.equal(extractSessionToken(header, { secure: false }), "dev-token");
  });

  await t.test("Auth.js v4 cookie names are not read (CURRENT never reads them)", () => {
    assert.equal(extractSessionToken("__Secure-next-auth.session-token=v4", { secure: true }), null);
    assert.equal(extractSessionToken("next-auth.session-token=v4", { secure: false }), null);
  });

  await t.test("first occurrence of a duplicated cookie wins", () => {
    const header = "__Secure-authjs.session-token=FIRST; __Secure-authjs.session-token=SECOND";
    assert.equal(parseCookieHeader(header)["__Secure-authjs.session-token"], "FIRST");
    assert.equal(extractSessionToken(header, { secure: true }), "FIRST");
  });

  await t.test("joins every cookie starting with the session name, by chunk index (Auth.js SessionStore)", () => {
    const name = "__Secure-authjs.session-token";
    assert.equal(extractSessionToken(`${name}=abc; ${name}.1=def`, { secure: true }), "abcdef");
    assert.equal(extractSessionToken(`${name}.1=def; ${name}.0=abc`, { secure: true }), "abcdef");
    assert.equal(extractSessionToken(`${name}.0=abc`, { secure: true }), "abc");
    assert.equal(extractSessionToken(`${name}=abc; ${name}x=zzz`, { secure: true }), "abczzz");
    assert.equal(extractSessionToken(`${name}=; theme=dark`, { secure: true }), null);
  });

  await t.test("a single matching cookie is returned as is, whatever its suffix", () => {
    const name = "__Secure-authjs.session-token";
    assert.equal(extractSessionToken(`theme=dark; ${name}.7=abc; visitor=anon`, { secure: true }), "abc");
    assert.equal(extractSessionToken(`${name}=; ${name}.x=abc`, { secure: true }), "abc");
  });

  await t.test("the session name inside another cookie's value is not a cookie", () => {
    const name = "__Secure-authjs.session-token";
    for (const header of [`a= ${name}=abc`, `a=x ${name}=abc`, `a=\t${name}=abc`, `a=${name}=abc`]) {
      assert.equal(extractSessionToken(header, { secure: true }), null, header);
    }
    assert.equal(extractSessionToken(`a=1; \t ${name}=abc`, { secure: true }), "abc");
  });

  await t.test("chunk count cap: cap-1 and cap chunks join, cap+1 fails closed", () => {
    const name = "__Secure-authjs.session-token";
    // Header lists chunks in reverse index order; chunk k carries the digit k % 10.
    const header = (count) =>
      Array.from({ length: count }, (_, i) => count - 1 - i)
        .map((k) => `${name}.${k}=${k % 10}`)
        .join("; ");
    const joined = (count) => Array.from({ length: count }, (_, k) => k % 10).join("");
    for (const count of [MAX_SESSION_COOKIE_CHUNKS - 1, MAX_SESSION_COOKIE_CHUNKS]) {
      assert.equal(extractSessionToken(header(count), { secure: true }), joined(count), String(count));
    }
    assert.equal(extractSessionToken(header(MAX_SESSION_COOKIE_CHUNKS + 1), { secure: true }), null);
    // Empty chunks are not read by Auth.js and do not count.
    const withEmpty = `${header(MAX_SESSION_COOKIE_CHUNKS)}; ${name}.999=`;
    assert.equal(extractSessionToken(withEmpty, { secure: true }), joined(MAX_SESSION_COOKIE_CHUNKS));
  });

  await t.test("joined token length cap: cap chars are read, cap+1 fails closed", () => {
    const name = "__Secure-authjs.session-token";
    const atCap = "a".repeat(MAX_SESSION_TOKEN_LENGTH);
    assert.equal(extractSessionToken(`${name}=${atCap}`, { secure: true }), atCap);
    assert.equal(extractSessionToken(`${name}=${atCap}b`, { secure: true }), null);
    const half = "a".repeat(MAX_SESSION_TOKEN_LENGTH / 2);
    assert.equal(extractSessionToken(`${name}.0=${half}; ${name}.1=${half}`, { secure: true }), half + half);
    assert.equal(extractSessionToken(`${name}.0=${half}; ${name}.1=${half}b`, { secure: true }), null);
  });

  await t.test("a 32KB header of ~900 shuffled chunks fails closed", () => {
    const name = "__Secure-authjs.session-token";
    const count = 900;
    // 7919 is coprime with 900, so this visits every index once, out of order.
    const header = Array.from({ length: count }, (_, i) => `${name}.${(i * 7919) % count}=xx`).join("; ");
    assert.ok(header.length >= 32 * 1024, String(header.length));
    assert.equal(extractSessionToken(header, { secure: true }), null);
  });

  await t.test("session-prefixed name cap counts empty and repeated names, and fails closed above it", () => {
    const name = "__Secure-authjs.session-token";
    const empties = (count) => Array.from({ length: count }, (_, i) => `${name}.${i + 1}=`).join("; ");
    const atCap = `${empties(MAX_SESSION_COOKIE_NAMES - 1)}; ${name}=abc`;
    assert.equal(extractSessionToken(atCap, { secure: true }), "abc");
    assert.equal(extractSessionToken(`${empties(MAX_SESSION_COOKIE_NAMES)}; ${name}=abc`, { secure: true }), null);
    const repeated = Array.from({ length: MAX_SESSION_COOKIE_NAMES + 1 }, () => `${name}=abc`).join("; ");
    assert.equal(extractSessionToken(repeated, { secure: true }), null);
  });

  await t.test("a 128KB header (Cloudflare's request header limit) stays within the S4 2ms budget", () => {
    const name = "__Secure-authjs.session-token";
    const token = "t".repeat(36);
    const junk = (count) => Array.from({ length: count }, (_, i) => `c${i}=v`).join("; ");
    const cases = [
      [junk(12000), null],
      [`${junk(11000)}; ${name}=${token}`, token],
      [`${name}=${"a".repeat(MAX_SESSION_TOKEN_LENGTH)}; ${junk(11000)}`, "a".repeat(MAX_SESSION_TOKEN_LENGTH)],
      [Array.from({ length: 3400 }, (_, i) => `${name}.${(i * 7919) % 3400}=xx`).join("; "), null],
      // Empty and repeated chunks are skipped by Auth.js but still matched by name.
      [Array.from({ length: 3500 }, (_, i) => `${name}.${i}=`).join("; "), null],
      [Array.from({ length: 3500 }, () => `${name}=${token}`).join("; "), null],
      // Prefixed segments without `=` are skipped in one jump, not rescanned per match.
      [`${Array.from({ length: 4500 }, () => name).join("; ")}; a=b`, null],
      // The prefix inside values, and after another name, is not a session cookie name.
      [Array.from({ length: 4500 }, (_, i) => `c${i}=${name}`).join("; "), null],
      [Array.from({ length: 4500 }, () => `x${name}=${token}`).join("; "), null],
      // Long space and tab runs around the name and value are trimmed like Auth.js.
      [`${" \t".repeat(32 * 1024)}${name}${" ".repeat(16 * 1024)}=${" ".repeat(16 * 1024)}${token}\t`, token],
    ];
    for (const [header, expected] of cases) {
      assert.ok(header.length >= 64 * 1024, String(header.length));
      assert.equal(extractSessionToken(header, { secure: true }), expected);
      // Best of 20, as in scripts/migration-gateway.test.mjs: the max of a wall clock is GC and
      // parallel-runner noise here. This pins the per-header cost (the full parse cost 4-6ms).
      let best = Infinity;
      for (let r = 0; r < 20; r++) {
        const start = performance.now();
        extractSessionToken(header, { secure: true });
        best = Math.min(best, performance.now() - start);
      }
      assert.ok(best < 2, `${header.length} bytes took ${best.toFixed(3)}ms`);
    }
  });

  await t.test("prototype keys are ordinary cookie names", () => {
    const parsed = parseCookieHeader("__proto__=x; constructor=y");
    assert.equal(parsed["__proto__"], "x");
    assert.equal(parsed["constructor"], "y");
  });

  await t.test("returns null for empty or missing cookie header", () => {
    for (const header of [null, undefined, "", "theme=dark; visitor=anon"]) {
      assert.equal(extractSessionToken(header, { secure: true }), null);
    }
  });
});

test("T01: valid Next session cookie resolves to the same user", async (t) => {
  const d1 = createTestD1();
  t.after(() => d1.close());

  const user = await resolveSessionUser(d1, SESSIONS.valid.sessionToken, {
    now: BASELINE_NOW_MS,
  });

  assert.ok(user, "valid session must resolve a user");
  assert.equal(user.id, USERS.valid.id);
  assert.equal(user.name, USERS.valid.name);
  assert.equal(user.email, USERS.valid.email);
  assert.equal(user.role, "user");
  assert.equal(user.is_banned, 0);
  assert.equal(user.active_x_user_id, USERS.valid.active_x_user_id);
});

test("T02: expired session resolves to null (unauthenticated)", async (t) => {
  const d1 = createTestD1();
  t.after(() => d1.close());

  const user = await resolveSessionUser(d1, SESSIONS.expired.sessionToken, {
    now: BASELINE_NOW_MS,
  });

  assert.equal(user, null, "expired session must return null");
});

test("T02: deleted / non-existent session token resolves to null", async (t) => {
  const d1 = createTestD1();
  t.after(() => d1.close());

  const user = await resolveSessionUser(d1, SESSIONS.deletedToken, {
    now: BASELINE_NOW_MS,
  });

  assert.equal(user, null, "deleted/unknown session token must return null");
});

test("T03: banned user is resolved with is_banned=1 and rejected by requireAuth", async (t) => {
  const d1 = createTestD1();
  t.after(() => d1.close());

  const user = await resolveSessionUser(d1, SESSIONS.banned.sessionToken, {
    now: BASELINE_NOW_MS,
  });

  assert.ok(user, "banned session must still resolve user object");
  assert.equal(user.id, USERS.banned.id);
  assert.equal(user.is_banned, 1);

  // Test requireAuth guard rejection for banned user
  let nextCalled = false;
  const mockContext = {
    get: (key) => (key === "user" ? user : null),
    json: (body, status) => ({ body, status }),
  };

  const guard = requireAuth();
  const response = await guard(mockContext, async () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false, "banned user must not proceed to next handler");
  assert.equal(response.status, 403, "banned user must receive 403 Forbidden");
  assert.equal(response.body.error, "Forbidden");
});

test("T04: tampered cookie is rejected with at most 1 D1 query", async (t) => {
  const d1 = createTestD1();
  t.after(() => d1.close());

  d1.resetQueryCount();
  const tamperedToken = "malicious_token_with_'--DROP_TABLE";
  const user = await resolveSessionUser(d1, tamperedToken, {
    now: BASELINE_NOW_MS,
  });

  assert.equal(user, null);
  assert.equal(d1.getQueryCount(), 1, "tampered cookie must require at most 1 query");
});

test("T05: safe logging never leaks sessionToken on database errors", async (t) => {
  const secretToken = "very_sensitive_synthetic_session_token_12345";
  const failingDb = {
    prepare() {
      return {
        bind() {
          return {
            first: async () => {
              throw new Error(`D1 lookup failed for bound token: ${secretToken}`);
            },
          };
        },
      };
    },
  };

  const originalConsoleError = console.error;
  let loggedOutput = "";
  console.error = (...args) => {
    loggedOutput += args.join(" ");
  };

  try {
    const user = await resolveSessionUser(failingDb, secretToken);
    assert.equal(user, null);
    assert.ok(
      loggedOutput.includes("D1_LOOKUP_FAILED"),
      "error should be logged",
    );
    assert.ok(
      !loggedOutput.includes(secretToken),
      "SECURITY VIOLATION: sessionToken was logged in error output!",
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("Hono sessionMiddleware attaches user and session per-request", async (t) => {
  const d1 = createTestD1();
  t.after(() => d1.close());

  const middleware = sessionMiddleware({ now: () => BASELINE_NOW_MS });

  await t.test("authenticates valid request from __Secure- cookie", async () => {
    const contextMap = new Map();
    const mockContext = {
      req: {
        url: "https://flamenode.net/api/me",
        header: (name) =>
          name.toLowerCase() === "cookie"
            ? `${BASELINE_COOKIES.sessionToken.name}=${SESSIONS.valid.sessionToken}`
            : undefined,
      },
      env: { DB: d1 },
      set: (key, val) => contextMap.set(key, val),
    };

    let nextCalled = false;
    await middleware(mockContext, async () => {
      nextCalled = true;
    });

    assert.ok(nextCalled);
    const user = contextMap.get("user");
    const session = contextMap.get("session");
    assert.ok(user);
    assert.equal(user.id, USERS.valid.id);
    assert.deepEqual(session, { user });
  });

  await t.test("handles unauthenticated request gracefully", async () => {
    const contextMap = new Map();
    const mockContext = {
      req: {
        url: "https://flamenode.net/api/me",
        header: () => undefined,
      },
      env: { DB: d1 },
      set: (key, val) => contextMap.set(key, val),
    };

    let nextCalled = false;
    await middleware(mockContext, async () => {
      nextCalled = true;
    });

    assert.ok(nextCalled);
    assert.equal(contextMap.get("user"), null);
    assert.equal(contextMap.get("session"), null);
  });
});

test("requireAuth rejects unauthenticated requests with 401", async () => {
  let nextCalled = false;
  const mockContext = {
    get: (key) => (key === "user" ? null : undefined),
    json: (body, status) => ({ body, status }),
  };

  const guard = requireAuth();
  const response = await guard(mockContext, async () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.status, 401);
  assert.equal(response.body.error, "Unauthorized");
});

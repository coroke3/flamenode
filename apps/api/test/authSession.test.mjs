import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  extractSessionToken,
  parseCookieHeader,
  resolveSessionUser,
  sessionMiddleware,
  requireAuth,
  SESSION_COOKIE_NAMES,
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
  await t.test("parses cookies with various formats, whitespace, and quotes", () => {
    const parsed = parseCookieHeader(
      '__Secure-authjs.session-token="token-with-quotes"; theme=dark; authjs.session-token=dev-token',
    );
    assert.equal(parsed["__Secure-authjs.session-token"], "token-with-quotes");
    assert.equal(parsed["theme"], "dark");
    assert.equal(parsed["authjs.session-token"], "dev-token");
  });

  await t.test("prioritizes secure session cookie over dev cookie", () => {
    const token = extractSessionToken(
      "authjs.session-token=dev-token; __Secure-authjs.session-token=secure-token",
    );
    assert.equal(token, "secure-token");
  });

  await t.test("falls back to dev cookie when secure cookie is absent", () => {
    const token = extractSessionToken("authjs.session-token=dev-token; other=123");
    assert.equal(token, "dev-token");
  });

  await t.test("returns null for empty or missing cookie header", () => {
    assert.equal(extractSessionToken(null), null);
    assert.equal(extractSessionToken(undefined), null);
    assert.equal(extractSessionToken(""), null);
    assert.equal(extractSessionToken("theme=dark; visitor=anon"), null);
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

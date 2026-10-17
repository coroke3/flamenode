import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";
import {
  AUTH_BASELINE_ENV,
  BASELINE_COOKIES,
  BASELINE_NOW_MS,
  DISCORD_ACCOUNTS,
  SESSIONS,
  USERS,
} from "./authBaseline.fixture.mjs";

// Characterizes CURRENT Auth.js behaviour: the real buildAuthConfig() from
// src/lib/auth/index.ts runs through @auth/core against an in-memory D1 built from
// every file in migrations/. Nothing here reimplements auth logic.
if (runTestWithTsx(import.meta.url)) {
  globalThis.__authBaselineContext = { env: {} };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return {
          url:
            "data:text/javascript," +
            encodeURIComponent(
              "export async function getCloudflareContext() { return globalThis.__authBaselineContext; }",
            ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { Auth } = await import("@auth/core");
  const { buildAuthConfig } = await import("./index.ts");
  const { linkDiscordAccountAtomically } = await import("./accountLinkAdapter.ts");
  const { resolveActiveXUserId } = await import("./resolveActiveXId.ts");
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../db/schema.ts");

  const migrationsDir = new URL("../../../migrations/", import.meta.url);
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"));

  function createD1Client(sqlite) {
    const meta = (changes = 0) => ({ duration: 0, changes, last_row_id: 0, changed_db: changes > 0 });
    function execute(query, params, method) {
      const statement = sqlite.prepare(query);
      if (method === "run") {
        const info = statement.run(...params);
        return { success: true, results: [], meta: meta(Number(info.changes)) };
      }
      return { success: true, results: statement.all(...params), meta: meta() };
    }
    function prepared(query, params = []) {
      return {
        query,
        params,
        bind: (...values) => prepared(query, values),
        run: async () => execute(query, params, "run"),
        all: async () => execute(query, params, "all"),
        raw: async () => execute(query, params, "all").results.map((row) => Object.values(row)),
        first: async (column) => {
          const row = execute(query, params, "all").results[0];
          return row ? (column ? row[column] : row) : null;
        },
      };
    }
    return {
      prepare: (query) => prepared(query),
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((s) =>
            execute(s.query, s.params, sqlite.prepare(s.query).columns().length > 0 ? "all" : "run"),
          );
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function createHarness(t) {
    const sqlite = new DatabaseSync(":memory:");
    for (const sql of migrations) sqlite.exec(sql);
    for (const user of Object.values(USERS)) {
      sqlite
        .prepare(
          `INSERT INTO "user" (id, name, email, role, is_banned, discord_id, active_x_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(user.id, user.name, user.email, user.role, user.is_banned, user.discord_id, user.active_x_user_id);
    }
    for (const session of Object.values(SESSIONS)) {
      if (typeof session === "string") continue;
      sqlite
        .prepare(`INSERT INTO "session" ("sessionToken", "userId", expires) VALUES (?, ?, ?)`)
        .run(session.sessionToken, session.userId, session.expiresMs);
    }
    const account = DISCORD_ACCOUNTS.linked;
    sqlite
      .prepare(
        `INSERT INTO "account" ("userId", type, provider, "providerAccountId") VALUES (?, ?, ?, ?)`,
      )
      .run(account.userId, account.type, account.provider, account.providerAccountId);

    const d1 = createD1Client(sqlite);
    // BUCKET and KV are required by getEnvAsync() but auth never calls them.
    const unused = () => {
      throw new Error("auth baseline must not touch R2/KV");
    };
    const storage = { get: unused, put: unused, delete: unused };
    globalThis.__authBaselineContext = {
      env: { ...AUTH_BASELINE_ENV, DB: d1, BUCKET: storage, KV: storage },
    };
    t.after(() => sqlite.close());
    return { sqlite, db: drizzle(d1, { schema }) };
  }

  async function authRequest(path, { method = "GET", cookies = {}, body } = {}) {
    const config = await buildAuthConfig();
    const headers = new Headers();
    const cookieHeader = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (cookieHeader) headers.set("cookie", cookieHeader);
    if (body) headers.set("content-type", "application/x-www-form-urlencoded");
    const request = new Request(`${AUTH_BASELINE_ENV.AUTH_URL}/api/auth/${path}`, {
      method,
      headers,
      body: body ? new URLSearchParams(body) : undefined,
    });
    return Auth(request, { ...config, basePath: "/api/auth" });
  }

  /** Parses Set-Cookie into {name: {value, attributes}} with lower-cased attribute names. */
  function setCookies(response) {
    const out = {};
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((part) => part.trim());
      const eq = pair.indexOf("=");
      const attributes = {};
      for (const attr of attrs) {
        const [key, ...rest] = attr.split("=");
        attributes[key.toLowerCase()] = rest.length ? rest.join("=") : true;
      }
      out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attributes };
    }
    return out;
  }

  function withoutVolatile(cookie) {
    const { expires, ...attributes } = cookie.attributes;
    return { attributes, hasExpires: expires !== undefined };
  }

  const SESSION_COOKIE = BASELINE_COOKIES.sessionToken.name;

  async function readSession(token) {
    const response = await authRequest("session", { cookies: { [SESSION_COOKIE]: token } });
    return { response, body: await response.json() };
  }

  test("U01: CSRF request sets the CURRENT cookie names and attributes", async (t) => {
    createHarness(t);
    const response = await authRequest("csrf");
    const cookies = setCookies(response);

    const csrf = cookies[BASELINE_COOKIES.csrfToken.name];
    assert.ok(csrf, `missing ${BASELINE_COOKIES.csrfToken.name}: ${Object.keys(cookies)}`);
    assert.deepEqual(withoutVolatile(csrf), BASELINE_COOKIES.csrfToken.observed);
  });

  test("U01: sign-out clears the session cookie and deletes the session row", async (t) => {
    const { sqlite } = createHarness(t);
    const csrfResponse = await authRequest("csrf");
    const csrfCookie = setCookies(csrfResponse)[BASELINE_COOKIES.csrfToken.name].value;
    const { csrfToken } = await csrfResponse.json();

    const response = await authRequest("signout", {
      method: "POST",
      cookies: {
        [SESSION_COOKIE]: SESSIONS.valid.sessionToken,
        [BASELINE_COOKIES.csrfToken.name]: csrfCookie,
      },
      body: { csrfToken },
    });
    const cleared = setCookies(response)[SESSION_COOKIE];

    assert.ok(cleared, "sign-out must send a Set-Cookie for the session token");
    assert.equal(cleared.value, "");
    assert.deepEqual(withoutVolatile(cleared), BASELINE_COOKIES.sessionToken.observedOnSignOut);
    const row = sqlite
      .prepare(`SELECT 1 FROM "session" WHERE "sessionToken" = ?`)
      .get(SESSIONS.valid.sessionToken);
    assert.equal(row, undefined);
  });

  test("T01/U02: valid session resolves the user with role, ban flag and Active X", async (t) => {
    createHarness(t);
    const { response, body } = await readSession(SESSIONS.valid.sessionToken);
    const cookie = setCookies(response)[SESSION_COOKIE];
    assert.equal(cookie?.value, SESSIONS.valid.sessionToken);
    assert.deepEqual(withoutVolatile(cookie), BASELINE_COOKIES.sessionToken.observedOnRead);
    const expiresInDays = (Date.parse(cookie.attributes.expires) - Date.now()) / 86_400_000;
    assert.ok(expiresInDays > 29 && expiresInDays <= 30, `session cookie expiry ${expiresInDays} days`);
    assert.deepEqual(
      {
        id: body.user.id,
        role: body.user.role,
        is_banned: body.user.is_banned,
        active_x_user_id: body.user.active_x_user_id,
      },
      {
        id: USERS.valid.id,
        role: "user",
        is_banned: 0,
        active_x_user_id: USERS.valid.active_x_user_id,
      },
    );
  });

  test("T01/U02: expired session is signed out and the row is deleted", async (t) => {
    const { sqlite } = createHarness(t);
    const { response, body } = await readSession(SESSIONS.expired.sessionToken);
    assert.equal(body, null);
    assert.equal(setCookies(response)[SESSION_COOKIE]?.value, "");
    const row = sqlite
      .prepare(`SELECT 1 FROM "session" WHERE "sessionToken" = ?`)
      .get(SESSIONS.expired.sessionToken);
    assert.equal(row, undefined);
  });

  test("U02: deleted (unknown) session token is signed out", async (t) => {
    createHarness(t);
    const { body } = await readSession(SESSIONS.deletedToken);
    assert.equal(body, null);
  });

  test("U02: banned user still gets a session with is_banned=1 (ban is enforced later)", async (t) => {
    createHarness(t);
    const { body } = await readSession(SESSIONS.banned.sessionToken);
    assert.equal(body.user.id, USERS.banned.id);
    assert.equal(body.user.is_banned, 1);
  });

  test("U02: session exposes the stored active_x_user_id as-is (not trusted downstream)", async (t) => {
    createHarness(t);
    assert.equal((await readSession(SESSIONS.noX.sessionToken)).body.user.active_x_user_id, null);
    assert.equal(
      (await readSession(SESSIONS.multiX.sessionToken)).body.user.active_x_user_id,
      USERS.multiX.active_x_user_id,
    );
  });

  // currentUser.ts ignores the session value and resolves Active X from approved links.
  function linkX(sqlite, authUserId, xUserId, approval) {
    sqlite
      .prepare(`INSERT OR IGNORE INTO "x_users" (id, x_name, approval_status) VALUES (?, ?, ?)`)
      .run(xUserId, xUserId, approval);
    sqlite
      .prepare(`INSERT INTO "x_user_account_links" (x_user_id, auth_user_id) VALUES (?, ?)`)
      .run(xUserId, authUserId);
  }

  test("U02: Active X resolution with 0, 1 and several linked X accounts", async (t) => {
    const { sqlite, db } = createHarness(t);
    const user = USERS.multiX.id;

    assert.equal(await resolveActiveXUserId(db, user, "x-mock-primary"), null, "0 links");

    linkX(sqlite, user, "x-mock-primary", "approved");
    assert.equal(await resolveActiveXUserId(db, user, null), "x-mock-primary", "1 link, none selected");

    linkX(sqlite, user, "x-mock-second", "approved");
    linkX(sqlite, user, "x-mock-pending", "pending");
    assert.equal(await resolveActiveXUserId(db, user, "X-Mock-Primary"), "x-mock-primary", "selected, case-insensitive");
    assert.equal(await resolveActiveXUserId(db, user, null), null, "several links, none selected");
    assert.equal(await resolveActiveXUserId(db, user, "x-mock-pending"), null, "selected but not approved");
    assert.equal(await resolveActiveXUserId(db, user, "x-mock-other"), null, "selected but not linked");
  });

  test("T02/U03: linking a Discord account owned by another user is rejected", async (t) => {
    const { db } = createHarness(t);
    await assert.rejects(
      linkDiscordAccountAtomically(db, DISCORD_ACCOUNTS.ownedByOther),
      /AUTH_DISCORD_ID_CONFLICT/,
    );
  });

  test("U03: re-linking the same Discord account to its owner succeeds without a duplicate row", async (t) => {
    const { db, sqlite } = createHarness(t);
    await linkDiscordAccountAtomically(db, DISCORD_ACCOUNTS.linked);
    const { count } = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM "account" WHERE provider = 'discord' AND "providerAccountId" = ?`)
      .get(DISCORD_ACCOUNTS.linked.providerAccountId);
    assert.equal(count, 1);
  });

  test("T03: redirect callback keeps relative paths on the auth origin and rejects other hosts", async (t) => {
    createHarness(t);
    const { callbacks } = await buildAuthConfig();
    const origin = AUTH_BASELINE_ENV.AUTH_URL;
    const redirect = (url) => callbacks.redirect({ url, baseUrl: origin });

    assert.equal(await redirect("/manage/events?tab=1"), `${origin}/manage/events?tab=1`);
    assert.equal(await redirect(`${origin}/profile?x=1`), `${origin}/profile?x=1`);
    assert.equal(await redirect("https://evil.example/steal"), `${origin}/dashboard`);
    assert.equal(await redirect(`https://evil.example/?next=${origin}`), `${origin}/dashboard`);
    assert.equal(await redirect(`${origin}.evil.example/`), `${origin}/dashboard`);
    assert.equal(await redirect("javascript:alert(1)"), `${origin}/dashboard`);
    // CURRENT quirk, recorded as-is: a protocol-relative URL starts with "/" and is
    // concatenated onto the origin, which keeps it on the auth host.
    assert.equal(await redirect("//evil.example/x"), `${origin}//evil.example/x`);
  });

  test("T04: fixture contains no real token or secret", () => {
    const all = JSON.stringify({ USERS, SESSIONS, DISCORD_ACCOUNTS, AUTH_BASELINE_ENV });
    assert.doesNotMatch(all, /eyJ[a-zA-Z0-9_-]{20,}/);
    for (const [key, value] of Object.entries(AUTH_BASELINE_ENV)) {
      if (/SECRET/.test(key)) assert.match(value, /^synthetic-/);
    }
    for (const session of Object.values(SESSIONS)) {
      const token = typeof session === "string" ? session : session.sessionToken;
      assert.match(token, /^synthetic_/);
    }
    assert.ok(BASELINE_NOW_MS > 0);
  });
}

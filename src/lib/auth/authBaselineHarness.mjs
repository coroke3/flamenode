import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import {
  AUTH_BASELINE_ENV,
  DISCORD_ACCOUNTS,
  SESSIONS,
  USERS,
} from "./authBaseline.fixture.mjs";

// Runs the real buildAuthConfig() from src/lib/auth/index.ts through @auth/core
// against an in-memory D1 built from every file in migrations/. Shared by the
// CURRENT characterization test and by parity tests of migrated session readers.
// Call only inside runTestWithTsx(), because index.ts is TypeScript.
export async function loadAuthBaseline() {
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
    return { sqlite, d1, db: drizzle(d1, { schema }) };
  }

  /** Sends a request to Auth.js. `cookieHeader` is passed verbatim when given. */
  async function authRequest(path, { method = "GET", cookies = {}, cookieHeader, body, origin } = {}) {
    const config = await buildAuthConfig();
    const headers = new Headers();
    const header =
      cookieHeader ??
      Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    if (header) headers.set("cookie", header);
    if (body) headers.set("content-type", "application/x-www-form-urlencoded");
    const request = new Request(`${origin ?? AUTH_BASELINE_ENV.AUTH_URL}/api/auth/${path}`, {
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

  return { Auth, buildAuthConfig, createHarness, authRequest, setCookies };
}

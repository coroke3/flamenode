import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

import { requireAuth, sessionMiddleware } from "../src/auth/session.ts";
import { costGuardMiddleware } from "../src/middleware/costGuard.ts";
import { onlyMutating, writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";

const NOW_MS = 1_800_000_000_000;
const TOKEN = "audit-session-token";
const COOKIE = `__Secure-authjs.session-token=${TOKEN}`;

/**
 * Deliberately models a persistent Auth.js cookie with an authoritative D1 user
 * row changing between requests. Never share a user/role cache across requests.
 */
test("MIG-0807 T04: BAN, role and user removal take effect on the next request", async () => {
  let user = { is_banned: 0, role: "admin" };
  let reads = 0;
  let writes = 0;
  const db = {
    prepare(sql) {
      assert.match(sql, /FROM "session" s/);
      assert.match(sql, /INNER JOIN "user" u/);
      return {
        bind(token) {
          return {
            async first() {
              reads += 1;
              if (token !== TOKEN || !user) return null;
              return {
                session_expires: NOW_MS + 60_000,
                user_id: "u-1",
                user_name: "Audit User",
                user_email: null,
                user_image: null,
                user_role: user.role,
                user_is_banned: user.is_banned,
                user_active_x_user_id: null,
              };
            },
          };
        },
      };
    },
    batch() { writes += 1; throw new Error("writes are forbidden in auth guard"); },
  };
  const app = new Hono();
  app.use("/private", sessionMiddleware({ now: () => NOW_MS }));
  app.use("/private", requireAuth());
  app.get("/private", (c) => c.json({ role: c.get("user").role }));
  const get = () => app.request("https://flamenode.example/private", {
    headers: { Cookie: COOKIE },
  }, { DB: db });

  const before = await get();
  assert.equal(before.status, 200);
  assert.deepEqual(await before.json(), { role: "admin" });
  assert.equal(before.headers.get("cache-control"), "private, no-store");

  user = { is_banned: 1, role: "admin" };
  const banned = await get();
  assert.equal(banned.status, 403);
  assert.deepEqual(await banned.json(), { error: "Forbidden", message: "User is banned" });
  assert.equal(banned.headers.get("cache-control"), "private, no-store");

  user = { is_banned: 0, role: "user" };
  const after = await get();
  assert.equal(after.status, 200);
  assert.deepEqual(await after.json(), { role: "user" });
  assert.equal(after.headers.get("cache-control"), "private, no-store");

  user = null;
  const deleted = await get();
  assert.equal(deleted.status, 401);
  assert.deepEqual(await deleted.json(), { error: "Unauthorized" });
  assert.equal(deleted.headers.get("cache-control"), "private, no-store");
  assert.equal(reads, 4, "the same cookie must re-check the DB every time");
  assert.equal(writes, 0);
});

test("MIG-0807 T03: CostGuard D1 failure or missing settings fails closed without a write", async () => {
  for (const state of ["db_failure", "no_settings"]) {
    let reads = 0;
    let writes = 0;
    let handlerCalled = false;
    const db = {
      prepare(query) {
        assert.match(query, /FROM system_settings/);
        return {
          bind(id) {
            assert.equal(id, "default");
            return {
              async first() {
                reads += 1;
                if (state === "db_failure") throw new Error("D1_PRIVATE_SENTINEL");
                return null;
              },
            };
          },
        };
      },
      batch() { writes += 1; throw new Error("a denied write must not execute"); },
    };
    const app = new Hono();
    // This middleware is deliberately after the identity guard in production;
    // the test isolates its own fail-closed boundary instead of bypassing it.
    app.use("/mutate", costGuardMiddleware("manage_event_update"));
    app.post("/mutate", (c) => {
      handlerCalled = true;
      c.env.DB.batch([]);
      return c.json({ ok: true });
    });
    const res = await app.request("https://flamenode.example/mutate", {
      method: "POST",
    }, { DB: db });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), {
      ok: false,
      reason: state === "db_failure" ? "cost_guard_blocked" : "maintenance_mode",
      message: state === "db_failure"
        ? "現在、この機能の書き込みは一時的に無効化されています。"
        : "現在、書き込みを一時停止しています (コストガード)。しばらく時間をおいてからお試しください。",
    });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(reads, 1);
    assert.equal(writes, 0);
    assert.equal(handlerCalled, false);
  }
});

test("MIG-0807: onlyMutating skips GET/HEAD/OPTIONS without consulting write guard", async () => {
  const app = new Hono();
  let guardCalls = 0;
  let handlerCalls = 0;
  app.use("/probe", onlyMutating(async (c, next) => {
    guardCalls += 1;
    return c.json({ ok: false, reason: "invalid_origin" }, 403);
  }));
  app.get("/probe", (c) => {
    handlerCalls += 1;
    return c.json({ ok: true });
  });
  app.options("/probe", (c) => c.body(null, 204));
  app.post("/probe", (c) => c.json({ unexpected: true }));
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const res = await app.request("https://flamenode.example/probe", { method });
    assert.ok([200, 204].includes(res.status), method);
  }
  const post = await app.request("https://flamenode.example/probe", { method: "POST" });
  assert.equal(post.status, 403);
  assert.deepEqual(await post.json(), { ok: false, reason: "invalid_origin" });
  assert.equal(guardCalls, 1, "safe methods must not run the write guard");
  assert.equal(handlerCalls, 2, "GET and synthesized HEAD are handled without a mutation");
});

test("MIG-0807 U03: SEC-0807-01 fix converts throwing D1 getters to private fail-closed responses", async () => {
  // This audit follows #445: the former pre-fix assert.rejects contract was unsafe
  // after the repair and must never be silently accepted as a passing security gate.
  const secret = "SYNCHRONOUS_DB_BINDING_ERROR";
  const site = "https://flamenode.example";
  const guardOptions = {
    loadSiteUrl: () => site,
    allowLocalPreview: () => false,
  };
  function throwingEnv() {
    let reads = 0;
    const env = Object.defineProperty({}, "DB", {
      get() { reads += 1; throw new Error(secret); },
    });
    return { env, reads: () => reads };
  }
  const runs = [
    {
      name: "session",
      makeApp() {
        const app = new Hono();
        app.use("/protected", sessionMiddleware());
        app.use("/protected", requireAuth());
        app.get("/protected", (c) => c.json({ mutated: true }));
        return app;
      },
      request: { headers: { Cookie: "__Secure-authjs.session-token=valid-token" } },
      reason: "database_unavailable",
    },
    {
      name: "writeGuard",
      makeApp() {
        const app = new Hono();
        app.use("/protected", async (c, next) => {
          c.set("user", { id: "admin-1", role: "admin", is_banned: 0 });
          c.set("sessionState", "user");
          await next();
        });
        app.use("/protected", writeGuardMiddleware(guardOptions));
        app.post("/protected", (c) => c.json({ mutated: true }));
        return app;
      },
      request: { method: "POST", headers: { Origin: site } },
      reason: "db_unavailable",
    },
    {
      name: "costGuard",
      makeApp() {
        const app = new Hono();
        app.use("/protected", costGuardMiddleware("manage_event_update"));
        app.post("/protected", (c) => c.json({ mutated: true }));
        return app;
      },
      request: { method: "POST" },
      reason: "cost_guard_blocked",
    },
  ];
  for (const entry of runs) {
    const { env, reads } = throwingEnv();
    const response = await entry.makeApp().request(site + "/protected", entry.request, env);
    assert.equal(response.status, 503, entry.name);
    assert.equal(response.headers.get("cache-control"), "private, no-store", entry.name);
    const body = await response.text();
    assert.doesNotMatch(body, /SYNCHRONOUS_DB_BINDING_ERROR|mutated/, entry.name);
    assert.equal(JSON.parse(body).reason ?? JSON.parse(body).error, entry.reason, entry.name);
    assert.equal(reads(), 1, entry.name + " binding getter must be read once");
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { app as mountedApi } from "../src/app.ts";

import { requireAuth, sessionMiddleware } from "../src/auth/session.ts";
import { costGuardMiddleware } from "../src/middleware/costGuard.ts";
import { writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";

const SITE = "https://app.flamenode.example";
const PRIVATE = "private, no-store";
const SENTINEL = "PROVIDER_SECRET_FROM_DB_GETTER";
const ADMIN = { id: "admin-1", role: "admin", is_banned: 0 };
const WRITE_OPTIONS = {
  loadSiteUrl: () => SITE,
  allowLocalPreview: () => false,
};

function throwingBinding() {
  let accesses = 0;
  const env = Object.defineProperty({}, "DB", {
    get() {
      accesses += 1;
      throw new Error(SENTINEL);
    },
  });
  return { env, accesses: () => accesses };
}

test("SEC-0807-01: session DB getter failure is private 503, never an unhandled provider exception", async () => {
  const { env, accesses } = throwingBinding();
  let downstream = 0;
  const app = new Hono();
  app.use("/me", sessionMiddleware());
  app.use("/me", requireAuth());
  app.get("/me", (c) => {
    downstream += 1;
    return c.json({ ok: true });
  });
  const logs = [];
  const originalLog = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  let response;
  try {
    response = await app.request(`${SITE}/me`, {
      headers: { Cookie: "__Secure-authjs.session-token=test-token" },
    }, env);
  } finally {
    console.error = originalLog;
  }
  assert.equal(response.status, 503);
  const body = await response.clone().text();
  assert.deepEqual(await response.json(), { error: "database_unavailable" });
  assert.equal(response.headers.get("cache-control"), PRIVATE);
  assert.equal(accesses(), 1);
  assert.equal(downstream, 0);
  assert.doesNotMatch(logs.join(" "), /PROVIDER_SECRET_FROM_DB_GETTER/);
  assert.doesNotMatch(body, /PROVIDER_SECRET_FROM_DB_GETTER/);
});

test("SEC-0807-01: unauthenticated request never reads a throwing session DB getter", async () => {
  const { env, accesses } = throwingBinding();
  const app = new Hono();
  app.use("/me", sessionMiddleware());
  app.use("/me", requireAuth());
  app.get("/me", (c) => c.json({ ok: true }));
  const response = await app.request(`${SITE}/me`, {}, env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), PRIVATE);
  assert.equal(accesses(), 0);
});

test("SEC-0807-01: write DB getter failure returns private 503 without mutation", async () => {
  const { env, accesses } = throwingBinding();
  let mutations = 0;
  const app = new Hono();
  app.use("/write", async (c, next) => {
    c.set("user", ADMIN);
    c.set("sessionState", "user");
    await next();
  });
  app.use("/write", writeGuardMiddleware(WRITE_OPTIONS));
  app.post("/write", (c) => {
    mutations += 1;
    return c.json({ ok: true });
  });
  const response = await app.request(`${SITE}/write`, {
    method: "POST", headers: { Origin: SITE },
  }, env);
  assert.equal(response.status, 503);
  const body = await response.clone().text();
  assert.deepEqual(await response.json(), {
    ok: false, reason: "db_unavailable", message: "DB に接続できません。",
  });
  assert.equal(response.headers.get("cache-control"), PRIVATE);
  assert.equal(accesses(), 1);
  assert.equal(mutations, 0);
  assert.doesNotMatch(body, /PROVIDER_SECRET_FROM_DB_GETTER/);
});

test("SEC-0807-01: Origin and identity denials happen before DB binding access", async () => {
  for (const { origin, user, sessionState, status, reason } of [
    { origin: "https://evil.example", user: ADMIN, sessionState: "user", status: 403, reason: "invalid_origin" },
    { origin: SITE, user: null, sessionState: "none", status: 401, reason: "unauthenticated" },
    { origin: SITE, user: null, sessionState: "unavailable", status: 503, reason: "database_unavailable" },
    { origin: SITE, user: ADMIN, sessionState: "unavailable", status: 503, reason: "database_unavailable" },
  ]) {
    const { env, accesses } = throwingBinding();
    let mutations = 0;
    const app = new Hono();
    app.use("/write", async (c, next) => {
      c.set("user", user);
      c.set("sessionState", sessionState);
      await next();
    });
    app.use("/write", writeGuardMiddleware(WRITE_OPTIONS));
    app.post("/write", (c) => {
      mutations += 1;
      return c.json({ ok: true });
    });
    const response = await app.request(`${SITE}/write`, {
      method: "POST", headers: { Origin: origin },
    }, env);
    assert.equal(response.status, status, reason);
    assert.equal((await response.json()).reason, reason);
    assert.equal(response.headers.get("cache-control"), PRIVATE);
    assert.equal(accesses(), 0, reason);
    assert.equal(mutations, 0, reason);
  }
});

test("SEC-0807-01: unavailable Origin configuration denies before throwing D1 binding", async () => {
  const { env, accesses } = throwingBinding();
  let mutations = 0;
  const app = new Hono();
  app.use("/write", async (c, next) => {
    c.set("user", ADMIN);
    c.set("sessionState", "user");
    await next();
  });
  app.use("/write", writeGuardMiddleware({
    loadSiteUrl: () => { throw new Error(SENTINEL); },
    allowLocalPreview: () => false,
  }));
  app.post("/write", (c) => {
    mutations += 1;
    return c.json({ ok: true });
  });
  const response = await app.request(`${SITE}/write`, {
    method: "POST",
    headers: { Origin: SITE },
  }, env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "origin_verification_unavailable",
    message: "Origin を検証できません。",
  });
  assert.equal(response.headers.get("cache-control"), PRIVATE);
  assert.equal(accesses(), 0, "Origin failure must not consult DB getter");
  assert.equal(mutations, 0);
});

test("SEC-0807-01: CostGuard DB getter failure returns private 503 without mutation", async () => {
  const { env, accesses } = throwingBinding();
  let mutations = 0;
  const app = new Hono();
  app.use("/write", costGuardMiddleware("manage_event_update"));
  app.post("/write", (c) => {
    mutations += 1;
    return c.json({ ok: true });
  });
  const response = await app.request(`${SITE}/write`, { method: "POST" }, env);
  assert.equal(response.status, 503);
  const body = await response.clone().text();
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "cost_guard_blocked",
    message: "現在、この機能の書き込みは一時的に無効化されています。",
  });
  assert.equal(response.headers.get("cache-control"), PRIVATE);
  assert.equal(accesses(), 1);
  assert.equal(mutations, 0);
  assert.doesNotMatch(body, /PROVIDER_SECRET_FROM_DB_GETTER/);
});

test("SEC-0807-01: real mounted write routes fail closed before parsing input", async (t) => {
  // Exercise the production app/router composition, not only isolated guards.
  // A malformed body is intentional: it must never reach a write handler.
  for (const path of [
    "/api/admin/announcements",
    "/api/videos/video-1/chapters",
  ]) {
    await t.test(path, async () => {
      const { env, accesses } = throwingBinding();
      env.NEXT_PUBLIC_SITE_URL = SITE;
      const response = await mountedApi.request(`${SITE}${path}`, {
        method: "POST",
        headers: {
          Origin: SITE,
          Cookie: "__Secure-authjs.session-token=test-token",
          "Content-Type": "application/json",
        },
        body: "{invalid-json",
      }, env);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), PRIVATE);
      const body = await response.text();
      assert.match(body, /database_unavailable/);
      assert.doesNotMatch(body, /PROVIDER_SECRET_FROM_DB_GETTER/);
      assert.equal(accesses(), 1, "session must fail before handler/DB mutation");
    });
  }
});

test("SEC-0807-01: real mounted origin denial never touches a throwing D1 binding", async (t) => {
  for (const path of [
    "/api/admin/announcements",
    "/api/videos/video-1/chapters",
  ]) {
    await t.test(path, async () => {
      const { env, accesses } = throwingBinding();
      env.NEXT_PUBLIC_SITE_URL = SITE;
      const response = await mountedApi.request(`${SITE}${path}`, {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          Cookie: "__Secure-authjs.session-token=test-token",
        },
      }, env);
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), PRIVATE);
      assert.equal((await response.json()).reason, "invalid_origin");
      assert.equal(accesses(), 0, "origin denial precedes session lookup");
    });
  }
});

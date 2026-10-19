import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { evaluateWriteIdentity } from "@flamenode/domain/admin";
import {
  evaluateAdminWriteGuard,
  writeGuardMiddleware,
} from "../src/middleware/writeOrigin.ts";

const SITE_URL = "https://app.flamenode.example";

function user(role = "admin", is_banned = 0) {
  return {
    id: "u-1",
    name: "Admin",
    email: "admin@example.com",
    image: null,
    role,
    is_banned,
    active_x_user_id: null,
  };
}

function tosState(is_tos_accepted = 1, terms_reaccept_required = 0) {
  return { is_tos_accepted, terms_reaccept_required };
}

function guard({ user: u = user(), hasDb = true, originOk = true, originUnavailable = false, tos = tosState(), loadTosStateThrows = false, loadTosStateReturnsNull = false } = {}) {
  return evaluateAdminWriteGuard({
    user: u,
    hasDb,
    originOk,
    originUnavailable,
    loadTosState: loadTosStateReturnsNull
      ? async () => null
      : loadTosStateThrows
        ? async () => {
            throw new Error("boom");
          }
        : async () => tos,
  });
}

// --- origin (CURRENT writeOriginGuard.ts / origin.ts) ---

test("guard: origin verification unavailable -> 503 origin_verification_unavailable", async () => {
  const outcome = await guard({ originUnavailable: true, originOk: true });
  assert.deepEqual(outcome, { ok: false, status: 503, reason: "origin_verification_unavailable" });
});

test("guard: different origin -> 403 invalid_origin (T01)", async () => {
  const outcome = await guard({ originOk: false });
  assert.deepEqual(outcome, { ok: false, status: 403, reason: "invalid_origin" });
});

// --- auth / db ---

test("guard: no session user -> 401 unauthenticated (T02-auth)", async () => {
  const outcome = await guard({ user: null });
  assert.deepEqual(outcome, { ok: false, status: 401, reason: "unauthenticated" });
});

test("guard: no D1 binding -> 503 db_unavailable", async () => {
  const outcome = await guard({ hasDb: false });
  assert.deepEqual(outcome, { ok: false, status: 503, reason: "db_unavailable" });
});

test("guard: TOS read error -> 503 db_unavailable (fail-closed)", async () => {
  const outcome = await guard({ loadTosStateThrows: true });
  assert.deepEqual(outcome, { ok: false, status: 503, reason: "db_unavailable" });
});

test("guard: missing user row -> 503 db_unavailable (fail-closed)", async () => {
  const outcome = await guard({ loadTosStateReturnsNull: true });
  assert.deepEqual(outcome, { ok: false, status: 503, reason: "db_unavailable" });
});

// --- identity: same cases as src/lib/auth/writeGuardCore.test.mjs ---

test("guard: identity deny matrix matches evaluateWriteIdentity (requiredRole admin)", async () => {
  const matrix = [
    { fields: { role: "admin", is_banned: 1, is_tos_accepted: 1, terms_reaccept_required: 0 }, expect: "banned" },
    { fields: { role: "admin", is_banned: 0, is_tos_accepted: 0, terms_reaccept_required: 0 }, expect: "tos_required" },
    { fields: { role: "admin", is_banned: 0, is_tos_accepted: 1, terms_reaccept_required: 1 }, expect: "tos_reaccept_required" },
    { fields: { role: "moderator", is_banned: 0, is_tos_accepted: 1, terms_reaccept_required: 0 }, expect: "forbidden" },
    { fields: { role: "user", is_banned: 0, is_tos_accepted: 1, terms_reaccept_required: 0 }, expect: "forbidden" },
    { fields: { role: "admin", is_banned: 0, is_tos_accepted: 1, terms_reaccept_required: 0 }, expect: null },
  ];
  for (const { fields, expect } of matrix) {
    assert.equal(evaluateWriteIdentity(fields, "admin"), expect, `CURRENT: ${fields.role} banned=${fields.is_banned}`);
  }
});

test("guard: banned admin -> 403 banned (T02)", async () => {
  const outcome = await guard({ user: user("admin", 1) });
  assert.deepEqual(outcome, { ok: false, status: 403, reason: "banned" });
});

test("guard: tos not accepted -> 403 tos_required", async () => {
  const outcome = await guard({ tos: tosState(0, 0) });
  assert.deepEqual(outcome, { ok: false, status: 403, reason: "tos_required" });
});

test("guard: reaccept required -> 403 tos_reaccept_required", async () => {
  const outcome = await guard({ tos: tosState(1, 1) });
  assert.deepEqual(outcome, { ok: false, status: 403, reason: "tos_reaccept_required" });
});

test("guard: non-admin -> 403 forbidden (T02)", async () => {
  const outcome = await guard({ user: user("moderator") });
  assert.deepEqual(outcome, { ok: false, status: 403, reason: "forbidden" });
});

test("guard: admin + same origin + clean state -> ok", async () => {
  const outcome = await guard();
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.user.role, "admin");
});

// --- Hono middleware adapter ---

function makeApp({ user: u, db }) {
  const app = new Hono();
  app.use("/api/admin/*", (c, next) => {
    c.set("user", u);
    return next();
  });
  app.use(
    "/api/admin/*",
    writeGuardMiddleware({
      loadSiteUrl: () => SITE_URL,
      allowLocalPreview: () => false,
    }),
  );
  app.post("/api/admin/me", (c) => c.json({ role: c.get("user")?.role ?? "none" }));
  return { app, env: { DB: db } };
}

function makeDb(tosRow) {
  return {
    prepare() {
      return {
        bind() {
          return {
            first: async () => tosRow,
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  };
}

const cleanTosRow = { is_tos_accepted: 1, terms_reaccept_required: 0 };

test("middleware: missing Origin header -> 403 invalid_origin (T01)", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", { method: "POST" }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "invalid_origin" });
});

test("middleware: different Origin -> 403 invalid_origin (T01)", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "invalid_origin" });
});

test("middleware: unauthenticated -> 401 (T02-auth)", async () => {
  const { app, env } = makeApp({ user: null, db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, reason: "unauthenticated" });
});

test("middleware: no D1 binding -> 503 db_unavailable", async () => {
  const { app } = makeApp({ user: user(), db: undefined });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, {});
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, reason: "db_unavailable" });
});

test("middleware: non-admin -> 403 forbidden (T02)", async () => {
  const { app, env } = makeApp({ user: user("moderator"), db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "forbidden" });
});

test("middleware: banned -> 403 banned (T02)", async () => {
  const { app, env } = makeApp({ user: user("admin", 1), db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "banned" });
});

test("middleware: tos not accepted -> 403 tos_required", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb({ is_tos_accepted: 0, terms_reaccept_required: 0 }) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "tos_required" });
});

test("middleware: reaccept required -> 403 tos_reaccept_required", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb({ is_tos_accepted: 1, terms_reaccept_required: 1 }) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "tos_reaccept_required" });
});

test("middleware: user row missing (deleted) -> 503 db_unavailable", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb(null) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, reason: "db_unavailable" });
});

test("middleware: admin + same origin + clean state -> passes (T03 guard part)", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { role: "admin" });
});

test("middleware: unconfigured site URL -> 503 origin_verification_unavailable", async () => {
  const app = new Hono();
  app.use("/api/admin/*", (c, next) => {
    c.set("user", user());
    return next();
  });
  app.use(
    "/api/admin/*",
    writeGuardMiddleware({
      loadSiteUrl: () => null,
      allowLocalPreview: () => false,
    }),
  );
  app.post("/api/admin/me", (c) => c.json({ ok: true }));
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, { DB: makeDb(cleanTosRow) });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, reason: "origin_verification_unavailable" });
});

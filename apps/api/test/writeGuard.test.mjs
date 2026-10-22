import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
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

test("guard: missing user row -> 401 unauthenticated (CURRENT getCurrentUser null)", async () => {
  const outcome = await guard({ loadTosStateReturnsNull: true });
  assert.deepEqual(outcome, { ok: false, status: 401, reason: "unauthenticated" });
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
  assert.deepEqual(await res.json(), { ok: false, reason: "unauthenticated", message: "ログインが必要です。" });
});

test("middleware: no D1 binding -> 503 db_unavailable", async () => {
  const { app } = makeApp({ user: user(), db: undefined });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, {});
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, reason: "db_unavailable", message: "DB に接続できません。" });
});

test("middleware: non-admin -> 403 forbidden (T02)", async () => {
  const { app, env } = makeApp({ user: user("moderator"), db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "forbidden", message: "この操作を実行する権限がありません。" });
});

test("middleware: banned -> 403 banned (T02)", async () => {
  const { app, env } = makeApp({ user: user("admin", 1), db: makeDb(cleanTosRow) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "banned", message: "現在、このアカウントは利用停止中です。" });
});

test("middleware: tos not accepted -> 403 tos_required", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb({ is_tos_accepted: 0, terms_reaccept_required: 0 }) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "tos_required", message: "利用規約への同意が必要です。" });
});

test("middleware: reaccept required -> 403 tos_reaccept_required", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb({ is_tos_accepted: 1, terms_reaccept_required: 1 }) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "tos_reaccept_required", message: "利用規約の最新版に再同意してください。" });
});

test("middleware: user row missing (deleted) -> 401 unauthenticated", async () => {
  const { app, env } = makeApp({ user: user(), db: makeDb(null) });
  const res = await app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, reason: "unauthenticated", message: "ログインが必要です。" });
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

// --- loadTosState: execute the real raw-D1 CASE SQL (CURRENT termsReacceptRequiredCondition mirror) ---
// The unit tests above stub prepare().bind().first() with a canned row, so the
// CASE expression is never executed. These drive the real SQL through
// node:sqlite (same adapter pattern as softwareSuggestions.test.mjs) and assert
// terms_reaccept_required for cases that would be a fail-open bug if the CASE
// were inverted (letting through a user who must re-accept TOS).

function createTosD1({ userRow, termsRows = [], consents = [] }) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      is_tos_accepted INTEGER,
      accepted_terms_version_id TEXT,
      discord_id TEXT, name TEXT, image TEXT, active_x_user_id TEXT
    );
    CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT, icon_url TEXT, approval_status TEXT);
    CREATE TABLE terms_versions (
      id TEXT PRIMARY KEY,
      severity TEXT,
      published_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE user_tos_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      terms_version_id TEXT
    );
  `);
  sqlite
    .prepare("INSERT INTO user (id, is_tos_accepted, accepted_terms_version_id) VALUES (?, ?, ?)")
    .run(userRow.id, userRow.is_tos_accepted, userRow.accepted_terms_version_id);
  for (const t of termsRows) {
    sqlite
      .prepare("INSERT INTO terms_versions (id, severity, published_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(t.id, t.severity, t.published_at, t.updated_at);
  }
  for (const c of consents) {
    sqlite
      .prepare("INSERT INTO user_tos_consents (id, user_id, terms_version_id) VALUES (?, ?, ?)")
      .run(c.id, c.user_id, c.terms_version_id);
  }
  return {
    prepare(sql) {
      return {
        bind(...params) {
          const stmt = sqlite.prepare(sql);
          return {
            first: async () => stmt.get(...params) ?? null,
            all: async () => ({ results: stmt.all(...params) }),
          };
        },
      };
    },
  };
}

const MAJOR_OLD = { id: "v-old", severity: "major", published_at: 100, updated_at: 100 };
const MAJOR_NEW = { id: "v-new", severity: "major", published_at: 200, updated_at: 200 };

async function postGuard(db) {
  const { app, env } = makeApp({ user: user(), db });
  return app.request("/api/admin/me", {
    method: "POST",
    headers: { Origin: SITE_URL },
  }, env);
}

test("loadTosState: accepted an old major, no consent -> 403 tos_reaccept_required", async () => {
  const db = createTosD1({
    userRow: { id: "u-1", is_tos_accepted: 1, accepted_terms_version_id: "v-old" },
    termsRows: [MAJOR_OLD, MAJOR_NEW],
  });
  const res = await postGuard(db);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "tos_reaccept_required", message: "利用規約の最新版に再同意してください。" });
});

test("loadTosState: accepted the latest major -> passes", async () => {
  const db = createTosD1({
    userRow: { id: "u-1", is_tos_accepted: 1, accepted_terms_version_id: "v-new" },
    termsRows: [MAJOR_OLD, MAJOR_NEW],
  });
  const res = await postGuard(db);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { role: "admin" });
});

test("loadTosState: mirror NULL but consent to latest major -> passes", async () => {
  const db = createTosD1({
    userRow: { id: "u-1", is_tos_accepted: 1, accepted_terms_version_id: null },
    termsRows: [MAJOR_OLD, MAJOR_NEW],
    consents: [{ id: "c-1", user_id: "u-1", terms_version_id: "v-new" }],
  });
  const res = await postGuard(db);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { role: "admin" });
});

test("loadTosState: no published major terms -> passes (reaccept 0)", async () => {
  const db = createTosD1({
    userRow: { id: "u-1", is_tos_accepted: 1, accepted_terms_version_id: null },
    termsRows: [{ id: "v-draft", severity: "major", published_at: null, updated_at: 100 }],
  });
  const res = await postGuard(db);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { role: "admin" });
});

test("loadTosState: is_tos_accepted = 0 -> 403 tos_required", async () => {
  const db = createTosD1({
    userRow: { id: "u-1", is_tos_accepted: 0, accepted_terms_version_id: null },
    termsRows: [MAJOR_NEW],
  });
  const res = await postGuard(db);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, reason: "tos_required", message: "利用規約への同意が必要です。" });
});

// MIG-0602 U02 fix round: S3 D1 budget (<= 3 pre-reads + 1 batch), 64KB body
// cap, origin-before-session, contracts schemas, generalized write guard
// (requiredRole / activeX) mounted as writeGuardMiddleware({ requiredRole, activeX }).
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  ApiEndpointSetActiveBodySchema,
  AnnouncementWriteBodySchema,
} from "@flamenode/contracts";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { MAX_ADMIN_JSON_BODY_BYTES } from "../src/routes/admin/body.ts";
import { costGuardMiddleware } from "../src/middleware/costGuard.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null };
const VALID = { title: "T", body: "B", severity: "info", target_audience: "all", is_published: 1 };

function setup({ cookieSession = false } = {}) {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const hono = new Hono();
  hono.route("/api/admin", createAdminRoutes({
    session: async (c, next) => {
      c.set("user", ADMIN);
      c.set("sessionState", "user");
      await next();
    },
  }));
  const request = (method, path, body, headers = { Origin: SITE }, raw) =>
    hono.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  return { ...d1, request, hono };
}

// ---------------- B2: D1 budget ----------------

test("S3 budget: every successful route uses <= 3 pre-reads and exactly 1 batch", async () => {
  const cases = [
    ["POST", "/api/admin/announcements", { ...VALID, id: "a-b" }, null, 2],
    ["PUT", "/api/admin/announcements/a-b", { ...VALID, title: "N", base_updated_at: 100 }, (s) => s.prepare("INSERT INTO announcements VALUES ('a-b','O','B','info',0,NULL,NULL,'all','x',50,100)").run(), 3],
    ["DELETE", "/api/admin/announcements/a-b", undefined, (s) => s.prepare("INSERT INTO announcements VALUES ('a-b','O','B','info',0,NULL,NULL,'all','x',50,100)").run(), 3],
    ["POST", "/api/admin/api-endpoints", { event_id: "ev-1" }, (s) => seedEvent(s), 3],
    ["PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: false }, (s) => seedEvent(s, { public_api_enabled: 1 }), 3],
  ];
  for (const [method, path, body, seed, expectedReads] of cases) {
    const { sqlite, request, stats } = setup();
    if (seed) seed(sqlite);
    const res = await request(method, path, body);
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.ok(stats.reads <= 3, `${method} ${path}: reads ${stats.reads}`);
    assert.equal(stats.reads, expectedReads, `${method} ${path} reads`);
    assert.equal(stats.batches, 1, `${method} ${path} batches`);
  }
});

test("S3 budget parity: guard-fed audit equals audit that reads settings/actor itself", async () => {
  const { sqlite, request } = setup();
  sqlite.prepare("UPDATE system_settings SET audit_normal_retention_days = 45").run();
  sqlite.prepare("UPDATE \"user\" SET image = 'https://img/u.png'").run();
  await request("POST", "/api/admin/announcements", { ...VALID, id: "a-p" });
  const a = sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(a.expires_at - a.created_at, 45 * 86400);
  assert.equal(JSON.parse(a.actor_snapshot_json).icon_url, "https://img/u.png");
});

// ---------------- B3: body cap ----------------

test("B3: Content-Length over 64KB -> 413 without reading", async () => {
  const { request, sqlite } = setup();
  const res = await request("POST", "/api/admin/announcements", undefined, { Origin: SITE, "content-length": String(MAX_ADMIN_JSON_BODY_BYTES + 1) }, "{}");
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, message: "リクエストが大きすぎます。" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("B3: actual body bytes over 64KB (no/lying Content-Length) -> 413 on every body route", async () => {
  const big = JSON.stringify({ ...VALID, body: "x".repeat(MAX_ADMIN_JSON_BODY_BYTES) });
  for (const [method, path] of [["POST", "/api/admin/announcements"], ["PUT", "/api/admin/announcements/a1"], ["POST", "/api/admin/api-endpoints"], ["PATCH", "/api/admin/api-endpoints/ev-1"]]) {
    const { request } = setup();
    const res = await request(method, path, undefined, { Origin: SITE }, big);
    assert.equal(res.status, 413, `${method} ${path}`);
    assert.equal((await res.json()).ok, false);
  }
});

test("B3: exactly 64KB passes the cap (then fails on domain validation, not 413)", async () => {
  const { request } = setup();
  const pad = "x".repeat(MAX_ADMIN_JSON_BODY_BYTES - JSON.stringify({ title: "", body: "" }).length);
  const raw = JSON.stringify({ title: "", body: pad });
  assert.equal(new TextEncoder().encode(raw).length, MAX_ADMIN_JSON_BODY_BYTES);
  const res = await request("POST", "/api/admin/announcements", undefined, { Origin: SITE }, raw);
  assert.equal(res.status, 400);
});

test("B3: non-JSON / array body -> 400", async () => {
  const { request } = setup();
  assert.equal((await request("POST", "/api/admin/announcements", undefined, { Origin: SITE }, "not json")).status, 400);
  assert.equal((await request("POST", "/api/admin/announcements", undefined, { Origin: SITE }, "[]")).status, 400);
});

// ---------------- non-blockers ----------------

test("apiEndpoints preflight read failure -> JSON 500 (not an unhandled error)", async () => {
  const { request, sqlite } = setup();
  seedEvent(sqlite);
  sqlite.exec("ALTER TABLE events RENAME TO events_gone");
  const original = console.error;
  console.error = () => {};
  try {
    const res = await request("POST", "/api/admin/api-endpoints", { event_id: "ev-1" });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, message: "更新が競合したか監査記録に失敗しました。" });
  } finally {
    console.error = original;
  }
});

test("public_api_enabled accepts JSON booleans, numbers and legacy strings", async () => {
  for (const [input, expected] of [[true, 1], [false, 0], [1, 1], [0, 0], ["1", 1], ["0", 0], [null, 0], [undefined, 0]]) {
    const parsed = ApiEndpointSetActiveBodySchema.parse(input === undefined ? {} : { public_api_enabled: input });
    assert.equal(parsed.public_api_enabled, expected, String(input));
  }
  assert.equal(ApiEndpointSetActiveBodySchema.safeParse({ public_api_enabled: "yes" }).success, false);
  assert.equal(ApiEndpointSetActiveBodySchema.safeParse({ public_api_enabled: {} }).success, false);
  const { request, sqlite } = setup();
  seedEvent(sqlite);
  assert.equal((await request("PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: true })).status, 200);
  assert.equal(sqlite.prepare("SELECT public_api_enabled FROM events").get().public_api_enabled, 1);
  const bad = await request("PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: "yes" });
  assert.equal(bad.status, 400);
});

test("contracts announcement body schema rejects wrong-typed fields", () => {
  assert.equal(AnnouncementWriteBodySchema.safeParse({ title: 1 }).success, false);
  assert.equal(AnnouncementWriteBodySchema.safeParse({ title: "a", is_published: true }).success, true);
});

// ---------------- LOW-1: origin before session ----------------

test("LOW-1: invalid-origin request with a session cookie costs zero D1 prepares and never runs session", async () => {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const before = d1.stats.prepares;
  let sessionRan = false;
  const hono = new Hono();
  hono.route("/api/admin", createAdminRoutes({
    session: async (c, next) => {
      sessionRan = true;
      await d1.db.prepare("SELECT 1").bind().first();
      await next();
    },
  }));
  const res = await hono.request("/api/admin/announcements", {
    method: "POST",
    headers: { Origin: "https://evil.example", cookie: "authjs.session-token=abc", "content-type": "application/json" },
    body: JSON.stringify(VALID),
  }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "invalid_origin");
  assert.equal(sessionRan, false);
  assert.equal(d1.stats.prepares - before, 0);
  // unconfigured site URL is also decided before any D1 access
  const res2 = await hono.request("/api/admin/announcements", { method: "POST", headers: { Origin: SITE } }, { DB: d1.db });
  assert.equal(res2.status, 503);
  assert.equal((await res2.json()).reason, "origin_verification_unavailable");
  assert.equal(sessionRan, false);
});

test("write-only checks skip GET/HEAD: a future admin read mounted under /api/admin is not blocked", async () => {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const admin = createAdminRoutes({ session: async (c, next) => { c.set("user", ADMIN); c.set("sessionState", "user"); await next(); } });
  admin.get("/ping", (c) => c.json({ pong: true }));
  const hono = new Hono();
  hono.route("/api/admin", admin);
  const res = await hono.request("/api/admin/ping", { method: "GET" }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  assert.equal(res.status, 200);
  assert.equal(d1.stats.reads, 0);
  const post = await hono.request("/api/admin/announcements", { method: "POST", headers: { Origin: "https://evil.example" } }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  assert.equal(post.status, 403);
});

// ---------------- generalized guard: requiredRole / activeX ----------------

function guardApp({ user, requiredRole, activeX: activeXOptions, settings = "normal", seed, mountCostGuard = true }) {
  const activeX = activeXOptions ? { feature: "manage_event_update", ...activeXOptions } : undefined;
  const d1 = createAdminD1();
  seedBase(d1.sqlite, { settings });
  d1.sqlite.exec("UPDATE \"user\" SET id = 'u-1', role = '" + user.role + "', active_x_user_id = " + (user.active_x_user_id ? "'" + user.active_x_user_id + "'" : "NULL"));
  if (seed) seed(d1.sqlite);
  const options = { loadSiteUrl: () => SITE, allowLocalPreview: () => false, requiredRole, activeX };
  const hono = new Hono();
  hono.use("*", originGuardMiddleware(options));
  hono.use("*", async (c, next) => {
    c.set("user", { ...user, id: "u-1" });
    c.set("sessionState", "user");
    await next();
  });
  hono.use("*", writeGuardMiddleware(options));
  if (mountCostGuard) hono.use("*", costGuardMiddleware("manage_event_update"));
  hono.post("/w", (c) => c.json({ ok: true, activeX: c.get("activeX") ?? null }));
  const post = () => hono.request("/w", { method: "POST", headers: { Origin: SITE } }, { DB: d1.db });
  return { ...d1, post };
}
const U = (role, x = null) => ({ name: "n", email: null, image: null, role, is_banned: 0, active_x_user_id: x });

test("requiredRole default is admin (moderator denied); null allows any authenticated user", async () => {
  assert.equal((await guardApp({ user: U("user") }).post()).status, 403);
  assert.equal((await guardApp({ user: U("moderator") }).post()).status, 403);
  assert.equal((await guardApp({ user: U("admin") }).post()).status, 200);
  assert.equal((await guardApp({ user: U("admin"), requiredRole: "admin" }).post()).status, 200);
  assert.equal((await guardApp({ user: U("moderator"), requiredRole: "admin" }).post()).status, 403);
  assert.equal((await guardApp({ user: U("user"), requiredRole: null }).post()).status, 200);
  assert.equal((await guardApp({ user: U("moderator"), requiredRole: null }).post()).status, 200);
});

test("requiredRole null still enforces banned / TOS before role", async () => {
  const g = guardApp({ user: { ...U("user"), is_banned: 1 }, requiredRole: null });
  const res = await g.post();
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "banned");
  const t = guardApp({ user: U("user"), requiredRole: null });
  t.sqlite.exec("UPDATE \"user\" SET is_tos_accepted = 0");
  assert.equal((await (await t.post()).json()).reason, "tos_required");
});

const ACTIVE_MESSAGES = {
  active_x_required: "X ID を選択してから操作してください。",
  active_x_rejected: "選択中の X ID は却下されています。別の X ID を選択してください。",
  active_x_not_approved: "承認済みの X ID が必要です。",
};

test("activeX.requireActiveXId: none -> 403 active_x_required; pending ok; rejected -> 403 active_x_rejected", async () => {
  const none = await guardApp({ user: U("admin"), activeX: { requireActiveXId: true } }).post();
  assert.equal(none.status, 403);
  assert.deepEqual(await none.json(), { ok: false, reason: "active_x_required", message: ACTIVE_MESSAGES.active_x_required });
  // active X id set but no x_users row -> approval status null -> required
  const orphan = await guardApp({ user: U("admin", "x1"), activeX: { requireActiveXId: true } }).post();
  assert.equal((await orphan.json()).reason, "active_x_required");
  const pending = guardApp({ user: U("admin", "x1"), activeX: { requireActiveXId: true }, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'pending')") });
  assert.equal((await pending.post()).status, 200);
  const rejected = guardApp({ user: U("admin", "x1"), activeX: { requireActiveXId: true }, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'rejected')") });
  const r = await rejected.post();
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { ok: false, reason: "active_x_rejected", message: ACTIVE_MESSAGES.active_x_rejected });
});

test("activeX.requireApprovedActiveXId: pending -> active_x_not_approved; approved but unlinked -> not approved; approved+linked -> ok", async () => {
  const opts = { requireApprovedActiveXId: true };
  const pending = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'pending')") });
  const p = await pending.post();
  assert.equal(p.status, 403);
  assert.deepEqual(await p.json(), { ok: false, reason: "active_x_not_approved", message: ACTIVE_MESSAGES.active_x_not_approved });
  const unlinked = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved')") });
  assert.equal((await (await unlinked.post()).json()).reason, "active_x_not_approved");
  const other = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('someone-else', 'x1')") });
  assert.equal((await (await other.post()).json()).reason, "active_x_not_approved");
  const ok = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x1'), ('u-1', 'x1')") });
  const res = await ok.post();
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).activeX, { activeXId: "x1", approvedXIds: ["x1"] });
  const none = await guardApp({ user: U("admin"), activeX: opts }).post();
  assert.equal((await none.json()).reason, "active_x_required");
});

test("activeX check runs AFTER CostGuard (CURRENT order) and adds no D1 read", async () => {
  const blocked = guardApp({ user: U("admin"), activeX: { requireApprovedActiveXId: true }, settings: "maintenance" });
  const res = await blocked.post();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "maintenance_mode");
  const plain = guardApp({ user: U("admin") });
  await plain.post();
  const withX = guardApp({ user: U("admin", "x1"), activeX: { requireApprovedActiveXId: true }, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x1')") });
  await withX.post();
  assert.equal(withX.stats.reads, plain.stats.reads);
});

test("fail closed: activeX route WITHOUT costGuardMiddleware still denies (and still checks CostGuard first)", async () => {
  const noX = guardApp({ user: U("admin"), activeX: { requireActiveXId: true }, mountCostGuard: false });
  const r1 = await noX.post();
  assert.equal(r1.status, 403);
  assert.equal((await r1.json()).reason, "active_x_required");
  const maint = guardApp({ user: U("admin"), activeX: { requireActiveXId: true }, settings: "maintenance", mountCostGuard: false });
  const r2 = await maint.post();
  assert.equal(r2.status, 503);
  assert.equal((await r2.json()).reason, "maintenance_mode");
  const ok = guardApp({ user: U("admin", "x1"), activeX: { requireApprovedActiveXId: true }, mountCostGuard: false, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x1')") });
  assert.equal((await ok.post()).status, 200);
  // activeX without a feature (misconfiguration) fails closed
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const hono = new Hono();
  const options = { loadSiteUrl: () => SITE, allowLocalPreview: () => false, activeX: { requireActiveXId: true } };
  hono.use("*", async (c, next) => { c.set("user", { ...U("admin"), id: "admin-1" }); c.set("sessionState", "user"); await next(); });
  hono.use("*", writeGuardMiddleware(options));
  hono.post("/w", (c) => c.json({ ok: true }));
  const res = await hono.request("/w", { method: "POST", headers: { Origin: SITE } }, { DB: d1.db });
  assert.equal(res.status, 503);
});

test("approved X IDs are bounded (LIMIT 100) and oversized JSON fails closed", async () => {
  const many = guardApp({
    user: U("admin", "x0"),
    activeX: { requireApprovedActiveXId: true },
    seed: (s) => {
      for (let i = 0; i < 150; i++) {
        s.exec(`INSERT INTO x_users (id, approval_status) VALUES ('x${i}', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x${i}')`);
      }
    },
  });
  const res = await many.post();
  assert.equal(res.status, 200);
  assert.ok((await res.json()).activeX.approvedXIds.length <= 100);
  // byte cap before JSON.parse: a lying/huge column value -> 503
  const huge = { prepare: () => ({ bind: () => ({ first: async () => ({ is_tos_accepted: 1, terms_reaccept_required: 0, discord_id: null, discord_name: null, active_x_user_id: "x1", user_image: null, x_name: null, x_icon_url: null, x_approval_status: "approved", approved_x_ids_json: JSON.stringify(["a".repeat(9000)]) }) }) }) };
  const hono = new Hono();
  const options = { loadSiteUrl: () => SITE, allowLocalPreview: () => false, activeX: { feature: "manage_event_update", requireApprovedActiveXId: true } };
  hono.use("*", async (c, next) => { c.set("user", { ...U("admin"), id: "u-1" }); c.set("sessionState", "user"); await next(); });
  hono.use("*", writeGuardMiddleware(options));
  hono.post("/w", (c) => c.json({ ok: true }));
  const r = await hono.request("/w", { method: "POST", headers: { Origin: SITE } }, { DB: huge });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reason, "db_unavailable");
});

// ---------------- default read guard for safe methods ----------------

function readApp({ user, sessionState = "user" }) {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const admin = createAdminRoutes({ session: async (c, next) => { c.set("user", user); c.set("sessionState", sessionState); await next(); } });
  admin.get("/ping", (c) => c.json({ pong: true }));
  const hono = new Hono();
  hono.route("/api/admin", admin);
  const get = (method = "GET") => hono.request("/api/admin/ping", { method }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  return { ...d1, get };
}

test("default read guard: GET denied unless authenticated admin (CURRENT requireRouteUser reasons), private no-store", async () => {
  const cases = [
    [{ user: null }, 401, "unauthorized"],
    [{ user: null, sessionState: "unavailable" }, 503, "database_unavailable"],
    [{ user: { ...ADMIN, is_banned: 1 } }, 403, "account_disabled"],
    [{ user: { ...ADMIN, role: "moderator" } }, 403, "forbidden"],
    [{ user: { ...ADMIN, role: "user" } }, 403, "forbidden"],
  ];
  for (const [input, status, error] of cases) {
    const app = readApp(input);
    const res = await app.get();
    assert.equal(res.status, status, error);
    assert.deepEqual(await res.json(), { error });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(app.stats.reads, 0);
  }
  const ok = readApp({ user: ADMIN });
  assert.equal((await ok.get()).status, 200);
  assert.equal((await ok.get("HEAD")).status, 200);
  assert.equal(ok.stats.reads, 0);
});

// ---------------- preload vs self-read audit rows ----------------

test("audit rows are identical whether settings/actor are preloaded by guards or self-read", async () => {
  const { mutateWithAudit } = await import("../src/audit/mutateWithAudit.ts");
  const originalNow = Date.now;
  const originalUuid = globalThis.crypto.randomUUID;
  const run = async (preloadedFrom) => {
    let n = 0;
    Date.now = () => 1_800_000_000_000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const d1 = createAdminD1();
    seedBase(d1.sqlite);
    d1.sqlite.exec("UPDATE system_settings SET audit_normal_retention_days = 45, audit_max_payload_bytes = 90000");
    d1.sqlite.exec("INSERT INTO x_users (id, x_name, icon_url, approval_status) VALUES ('x1', 'XN', 'https://i/x.png', 'approved'); UPDATE \"user\" SET active_x_user_id = 'x1', image = 'https://i/u.png'");
    const audits = [{ table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1", t: "日本語" }, actor_user_id: "admin-1", retention_class: "normal" }];
    const statement = { sql: "INSERT INTO announcements (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", params: ["a1", "t", "b", 1, 1] };
    let preloaded;
    if (preloadedFrom === "guards") {
      const { evaluateCostGuardWithSettings } = await import("../src/middleware/costGuard.ts");
      const cost = await evaluateCostGuardWithSettings(d1.db, "admin_announcement_broadcast");
      const user = d1.sqlite.prepare("SELECT u.discord_id, u.name AS discord_name, u.active_x_user_id, u.image AS user_image, x.x_name, x.icon_url AS x_icon_url FROM \"user\" u LEFT JOIN x_users x ON x.id = u.active_x_user_id WHERE u.id = 'admin-1'").get();
      const { actorSnapshotJsonFromRow } = await import("../src/audit/mutateWithAudit.ts");
      preloaded = { settings: cost.auditSettings, actorSnapshotJsonById: { "admin-1": actorSnapshotJsonFromRow(user) } };
    }
    const before = d1.stats.reads;
    await mutateWithAudit(d1.db, { mutationStatements: [statement], expectedMutationChanges: [1], audits, preloaded });
    return { rows: d1.sqlite.prepare("SELECT * FROM audit_logs").all(), reads: d1.stats.reads - before };
  };
  try {
    const self = await run("self");
    const guards = await run("guards");
    assert.equal(self.reads, 2);
    assert.equal(guards.reads, 0);
    assert.equal(self.rows.length, 1);
    assert.equal(JSON.stringify(guards.rows), JSON.stringify(self.rows));
    assert.equal(self.rows[0].expires_at - self.rows[0].created_at, 45 * 86400);
  } finally {
    Date.now = originalNow;
    globalThis.crypto.randomUUID = originalUuid;
  }
});

test("identity denies win over active X denies (banned before active_x_required)", async () => {
  const g = guardApp({ user: { ...U("admin"), is_banned: 1 }, activeX: { requireActiveXId: true } });
  assert.equal((await (await g.post()).json()).reason, "banned");
});

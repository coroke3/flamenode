import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createXidRoutes } from "../src/routes/xid/index.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const USER = {
  id: "admin-1", name: "Admin", email: null, image: null,
  role: "user", is_banned: 0, active_x_user_id: null,
};

function setup({ authenticated = true, role = "user", approved = true, linked = true, banned = false } = {}) {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite, { role });
  if (banned) sqlite.prepare('UPDATE "user" SET is_banned = 1 WHERE id = ?').run(USER.id);
  sqlite.exec("CREATE TABLE x_user_aliases (x_user_id TEXT, alias_x_id TEXT)");
  sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)")
    .run("x-one", "Creator", approved ? "approved" : "pending");
  if (linked) {
    sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id, x_user_id) VALUES (?, ?)")
      .run(USER.id, "x-one");
  }
  const hono = new Hono();
  hono.route("/api/xid", createXidRoutes({
    session: async (c, next) => {
      c.set("user", authenticated ? { ...USER, role, is_banned: banned ? 1 : 0 } : null);
      c.set("sessionState", authenticated ? "user" : "none");
      await next();
    },
  }));
  const request = (body = { x_user_id: "x-one" }, origin = SITE) => hono.request(
    "/api/xid/active",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    },
    { DB: db, NEXT_PUBLIC_SITE_URL: SITE },
  );
  return { sqlite, stats, request };
}

test("SA-098 switches an approved linked X ID, atomically with a user UPDATE audit", async () => {
  const { sqlite, stats, request } = setup();
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, message: "アクティブ X ID を切り替えました。" });
  assert.equal(sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id = ?').get(USER.id).active_x_user_id, "x-one");
  const audit = sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(audit.table_name, "user");
  assert.equal(audit.actor_user_id, USER.id);
  assert.equal(audit.actor_x_user_id, "x-one");
  assert.equal(JSON.parse(audit.before_json).active_x_user_id, null);
  assert.equal(JSON.parse(audit.after_json).active_x_user_id, "x-one");
  assert.equal(stats.batches, 1);
  assert.ok(stats.reads <= 3, `D1 S3 budget: ${stats.reads}`);
});

test("SA-098 already-selected identity is idempotent without a second audit", async () => {
  const { sqlite, stats, request } = setup();
  assert.equal((await request()).status, 200);
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, message: "すでにこの X ID がアクティブです。" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
  assert.equal(stats.batches, 1);
});

test("SA-098 refuses an unlinked X ID and an unapproved X ID", async () => {
  for (const config of [{ linked: false }, { approved: false }]) {
    const { sqlite, stats, request } = setup(config);
    const response = await request();
    assert.equal(response.status, 403);
    assert.equal((await response.json()).ok, false);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
    assert.equal(stats.batches, 0);
  }
});

test("SA-098 resolves a non-conflicting alias into its canonical active X ID", async () => {
  const { sqlite, request, stats } = setup();
  sqlite.prepare("INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES ('x-one', 'old')").run();
  const response = await request({ x_user_id: "@old" });
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare('SELECT active_x_user_id FROM "user"').get().active_x_user_id, "x-one");
  const audit = sqlite.prepare("SELECT actor_x_user_id, after_json FROM audit_logs").get();
  assert.equal(audit.actor_x_user_id, "x-one");
  assert.equal(JSON.parse(audit.after_json).active_x_user_id, "x-one");
  assert.equal(stats.batches, 1);
});

test("SA-098 denies a canonical / alias collision before any mutation", async () => {
  const { sqlite, request, stats } = setup();
  sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES ('x-two','Other','approved')").run();
  sqlite.prepare("INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES ('x-two', 'x-one')").run();
  const response = await request({ x_user_id: "x-one" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).message, "この X ID は現在のアカウントに紐づいていません。");
  assert.equal(stats.batches, 0);
});

test("SA-098 denies an alias whose canonical X approval status is null", async () => {
  const { sqlite, request, stats } = setup();
  sqlite.prepare("UPDATE x_users SET approval_status = NULL WHERE id = 'x-one'").run();
  sqlite.prepare("INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES ('x-one','old')").run();
  const response = await request({ x_user_id: "old" });
  assert.equal(response.status, 403);
  assert.equal(stats.batches, 0);
});

test("SA-098 denies an ambiguous alias with different canonical targets", async () => {
  const { sqlite, request, stats } = setup();
  sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES ('x-two','Other','approved')").run();
  sqlite.prepare("INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES ('x-one','old')").run();
  sqlite.prepare("INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES ('x-two','old')").run();
  const response = await request({ x_user_id: "old" });
  assert.equal(response.status, 403);
  assert.equal(stats.batches, 0);
});

test("SA-098 does not require an admin role, but requires a live session", async () => {
  const valid = setup({ role: "user" });
  assert.equal((await valid.request()).status, 200);
  const noAuth = setup({ authenticated: false });
  const response = await noAuth.request();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reason, "unauthenticated");
  assert.equal(noAuth.stats.batches, 0);
});

test("SA-098 denies missing TOS and major-terms reaccept without a mutation", async () => {
  {
    const { sqlite, request, stats } = setup();
    sqlite.prepare('UPDATE "user" SET is_tos_accepted = 0 WHERE id = ?').run(USER.id);
    const response = await request();
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, "tos_required");
    assert.equal(stats.batches, 0);
  }
  {
    const { sqlite, request, stats } = setup();
    sqlite.prepare("INSERT INTO terms_versions (id, severity, published_at, updated_at) VALUES ('major-v2', 'major', 1000, 1000)").run();
    const response = await request();
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, "tos_reaccept_required");
    assert.equal(stats.batches, 0);
  }
});

test("SA-098 strict audit uses the preloaded CURRENT actor snapshot", async () => {
  const { sqlite, request, stats } = setup();
  sqlite.prepare('UPDATE "user" SET discord_id = ?, name = ?, image = ? WHERE id = ?')
    .run("d-test", "Session Name", "https://img.example/u.png", USER.id);
  const response = await request();
  assert.equal(response.status, 200);
  const row = sqlite.prepare("SELECT actor_snapshot_json FROM audit_logs").get();
  const actor = JSON.parse(row.actor_snapshot_json);
  assert.equal(actor.discord_id, "d-test");
  assert.equal(actor.discord_name, "Session Name");
  assert.equal(actor.x_user_id, null);
  assert.equal(actor.icon_url, "https://img.example/u.png");
  assert.ok(stats.reads <= 3, `D1 pre-reads: ${stats.reads}`);
});

test("SA-098 cross-origin write fails before any database access", async () => {
  const { stats, request } = setup();
  const response = await request({ x_user_id: "x-one" }, "https://evil.example");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, "invalid_origin");
  assert.equal(stats.reads, 0);
  assert.equal(stats.batches, 0);
});

test("SA-098 banned or CostGuard-disabled identity cannot write", async () => {
  for (const banned of [true, false]) {
    const { sqlite, request, stats } = setup({ banned });
    if (!banned) {
      sqlite.prepare("UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'").run();
    }
    const response = await request();
    assert.equal(response.status, banned ? 403 : 503);
    assert.equal(stats.batches, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  }
});

test("SA-098 rejects malformed JSON and missing X ID without writing", async () => {
  const { sqlite, stats, request } = setup();
  const response = await request({ x_user_id: "" });
  assert.equal(response.status, 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(stats.batches, 0);
});

test("SA-098 returns 413 for oversized actual JSON bytes", async () => {
  const { request, stats } = setup();
  const response = await request({ x_user_id: "x-one", padding: "x".repeat(65536) });
  assert.equal(response.status, 413);
  assert.equal(stats.batches, 0);
});

test("SA-098 unmatched XID methods do not trigger write Origin/session/DB guards", async () => {
  let sessionCalls = 0;
  let dbReads = 0;
  const app = new Hono();
  app.route("/api/xid", createXidRoutes({
    session: async (_c, next) => { sessionCalls += 1; await next(); },
  }));
  const env = Object.defineProperty({ NEXT_PUBLIC_SITE_URL: SITE }, "DB", {
    get() {
      dbReads += 1;
      throw new Error("SECRET_D1_PROVIDER_MESSAGE");
    },
  });
  for (const [method, path] of [
    ["GET", "/api/xid/active"],
    ["HEAD", "/api/xid/active"],
    ["OPTIONS", "/api/xid/active"],
    ["GET", "/api/xid/not-found"],
    ["POST", "/api/xid/not-found"],
  ]) {
    const response = await app.request(`${SITE}${path}`, {
      method, headers: { Cookie: "__Secure-authjs.session-token=present" },
    }, env);
    assert.notEqual(response.status, 403, `${method} ${path} must not be treated as a write`);
    assert.notEqual(response.status, 503, `${method} ${path} must not consult the DB`);
  }
  assert.equal(sessionCalls, 0);
  assert.equal(dbReads, 0);
});

test("SA-098 throwing D1 binding fails closed with private 503 and no provider leak", async () => {
  let dbReads = 0;
  const app = new Hono();
  app.route("/api/xid", createXidRoutes({
    session: async (c, next) => {
      c.set("user", { ...USER });
      c.set("sessionState", "user");
      await next();
    },
  }));
  const env = Object.defineProperty({ NEXT_PUBLIC_SITE_URL: SITE }, "DB", {
    get() {
      dbReads += 1;
      throw new Error("SECRET_D1_PROVIDER_MESSAGE");
    },
  });
  const response = await app.request(`${SITE}/api/xid/active`, {
    method: "POST",
    headers: { Origin: SITE, "Content-Type": "application/json" },
    body: JSON.stringify({ x_user_id: "x-one" }),
  }, env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.text();
  assert.equal(JSON.parse(body).reason, "db_unavailable");
  assert.doesNotMatch(body, /SECRET_D1_PROVIDER_MESSAGE/);
  assert.equal(dbReads, 1);
});

test("SA-098 slash-variant cross-origin POST cannot bypass the write guard", async () => {
  const { db, sqlite } = createAdminD1();
  seedBase(sqlite, { role: "user" });
  let sessionCalls = 0;
  const app = new Hono();
  app.route("/api/xid", createXidRoutes({
    session: async (c, next) => {
      sessionCalls += 1;
      c.set("user", { ...USER });
      c.set("sessionState", "user");
      await next();
    },
  }));
  const response = await app.request(`${SITE}/api/xid/active/`, {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ x_user_id: "x-one" }),
  }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  assert.notEqual(response.status, 200);
  assert.ok([403, 404, 405].includes(response.status));
  assert.equal(sessionCalls, 0, "Origin rejection must precede session lookup");
});

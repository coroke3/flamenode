// MIG-0605 U01: RH-001 GET /api/account/summary on real SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { app } from "../src/app.ts";

const CACHE = "private, no-store, no-cache, must-revalidate";

function setup({ role = "user", banned = 0, active = null, failOn = [] } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, role TEXT, is_banned INTEGER, active_x_user_id TEXT);
    CREATE TABLE session ("sessionToken" TEXT PRIMARY KEY, "userId" TEXT, expires INTEGER);
    CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT, icon_url TEXT, approval_status TEXT);
    CREATE TABLE x_user_account_links (auth_user_id TEXT, x_user_id TEXT);
    CREATE TABLE x_identity_requests (id TEXT PRIMARY KEY, requested_by_auth_user_id TEXT, requested_x_id TEXT, status TEXT);
    CREATE TABLE event_staff (id TEXT PRIMARY KEY, event_id TEXT, x_user_id TEXT, permission_preset TEXT, custom_permission_keys_json TEXT);
  `);
  sqlite.prepare(`INSERT INTO "user" VALUES ('u1', ' Alice ', 'a@x', 'img', ?, ?, ?)`).run(role, banned, active);
  sqlite.prepare(`INSERT INTO session VALUES ('tok', 'u1', ?)`).run(Date.now() + 100000);
  const stmts = [];
  const db = {
    prepare: (sql) => ({
      bind: (...p) => ({
        first: async () => {
          stmts.push(sql);
          if (failOn.some((f) => sql.includes(f))) throw new Error("boom");
          return sqlite.prepare(sql).get(...p) ?? null;
        },
        all: async () => {
          stmts.push(sql);
          if (failOn.some((f) => sql.includes(f))) throw new Error("boom");
          return { results: sqlite.prepare(sql).all(...p) };
        },
      }),
    }),
  };
  const get = (path = "/api/account/summary", cookie = "authjs.session-token=tok") =>
    app.request("http://localhost" + path, { headers: cookie ? { cookie } : {} }, { DB: db });
  return { sqlite, stmts, get };
}

function addX(sqlite, id, status, name = null) {
  sqlite.prepare(`INSERT INTO x_users VALUES (?, ?, 'icon', ?)`).run(id, name, status);
  sqlite.prepare(`INSERT INTO x_user_account_links VALUES ('u1', ?)`).run(id);
}

test("T01 logged out (no cookie) -> {loggedIn:false} with CURRENT no-store headers, no D1", async () => {
  const { get, stmts } = setup();
  const res = await get(undefined, null);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { loggedIn: false });
  assert.equal(res.headers.get("Cache-Control"), CACHE);
  assert.equal(res.headers.get("Pragma"), "no-cache");
  assert.equal(res.headers.get("Expires"), "0");
  assert.equal(stmts.length, 0);
});

test("presence view: logged out / banned / logged in", async () => {
  const out = await setup().get("/api/account/summary?view=presence", null);
  assert.deepEqual(await out.json(), { view: "presence", loggedIn: false });
  assert.equal(out.headers.get("Cache-Control"), CACHE);
  const banned = await setup({ banned: 1 }).get("/api/account/summary?view=presence");
  assert.deepEqual(await banned.json(), { view: "presence", loggedIn: false });
  const ok = await setup().get("/api/account/summary?view=presence");
  assert.deepEqual(await ok.json(), { view: "presence", loggedIn: true, displayName: "Alice", icon: "img" });
  assert.equal(ok.headers.get("Cache-Control"), CACHE);
});

test("session lookup failure -> 503 unavailable (never logged-out), both views", async () => {
  const { get } = setup({ failOn: ['FROM "session"'] });
  const res = await get();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { loggedIn: false, unavailable: true });
  assert.equal(res.headers.get("Cache-Control"), CACHE);
  const p = await setup({ failOn: ['FROM "session"'] }).get("/api/account/summary?view=presence");
  assert.equal(p.status, 503);
  assert.deepEqual(await p.json(), { view: "presence", loggedIn: false, unavailable: true });
});

test("banned user -> {loggedIn:false}", async () => {
  const res = await setup({ banned: 1 }).get();
  assert.deepEqual(await res.json(), { loggedIn: false });
});

test("user with one approved X: active resolved, X rows, pending request, no manage", async () => {
  const s = setup();
  addX(s.sqlite, "alice", "approved", " Alice X ");
  s.sqlite.prepare(`INSERT INTO x_identity_requests VALUES ('r1', 'u1', 'Bob', 'pending')`).run();
  s.sqlite.prepare(`INSERT INTO x_identity_requests VALUES ('r2', 'u1', 'alice', 'pending')`).run();
  s.sqlite.prepare(`INSERT INTO x_identity_requests VALUES ('r3', 'u1', 'old', 'rejected')`).run();
  const res = await s.get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), CACHE);
  assert.deepEqual(await res.json(), {
    loggedIn: true,
    displayName: "Alice",
    icon: "img",
    role: "user",
    activeXId: "alice",
    xIds: [
      { x_user_id: "alice", x_name: "Alice X", icon_url: "icon", approval_status: "approved", is_active: true },
      { x_user_id: "bob", x_name: "@bob", icon_url: null, approval_status: "pending", is_active: false },
    ],
    canAccessAdmin: false,
    canAccessManage: false,
  });
  // S2 budget: session + linked/pending union + management = 3 statements.
  assert.equal(s.stmts.length, 3);
});

test("canAccessManage: staff preset with permissions, custom keys, public_staff does not", async () => {
  const s = setup();
  addX(s.sqlite, "alice", "approved");
  const staff = (id, preset, keys = null) =>
    s.sqlite.prepare(`INSERT INTO event_staff VALUES (?, 'ev', 'alice', ?, ?)`).run(id, preset, keys);
  staff("s1", "public_staff");
  assert.equal((await (await s.get()).json()).canAccessManage, false);
  staff("s2", "custom", '["not.a.key", 3]');
  assert.equal((await (await s.get()).json()).canAccessManage, false);
  staff("s3", "custom", "not json");
  assert.equal((await (await s.get()).json()).canAccessManage, false);
  staff("s4", "custom", '["event.slots"]');
  assert.equal((await (await s.get()).json()).canAccessManage, true);
  s.sqlite.exec(`DELETE FROM event_staff WHERE id='s4'`);
  staff("s5", "reviewer");
  assert.equal((await (await s.get()).json()).canAccessManage, true);
});

test("staff row of an unapproved X does not grant manage", async () => {
  const s = setup();
  addX(s.sqlite, "alice", "pending");
  s.sqlite.prepare(`INSERT INTO event_staff VALUES ('s1', 'ev', 'alice', 'owner', NULL)`).run();
  const body = await (await s.get()).json();
  assert.equal(body.canAccessManage, false);
  assert.equal(body.activeXId, null);
  assert.equal(body.xIds[0].is_active, false);
});

test("admin: manage/admin true without the management query", async () => {
  const s = setup({ role: "admin" });
  addX(s.sqlite, "a", "approved");
  addX(s.sqlite, "b", "approved");
  const body = await (await s.get()).json();
  assert.equal(body.canAccessAdmin, true);
  assert.equal(body.canAccessManage, true);
  assert.equal(body.activeXId, null); // two approved, none chosen
  assert.equal(s.stmts.length, 2);
});

test("explicit active X among several approved", async () => {
  const s = setup({ active: "B" });
  addX(s.sqlite, "a", "approved");
  addX(s.sqlite, "b", "approved");
  const body = await (await s.get()).json();
  assert.equal(body.activeXId, "b");
  assert.deepEqual(body.xIds.map((x) => x.is_active), [false, true]);
});

test("management query failure -> degraded with linked rows", async () => {
  const s = setup({ role: "moderator", active: "a", failOn: ["FROM event_staff"] });
  addX(s.sqlite, "a", "approved", "A");
  const res = await s.get();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    loggedIn: true,
    degraded: true,
    displayName: " Alice ",
    icon: "img",
    role: "moderator",
    activeXId: "a",
    xIds: [{ x_user_id: "a", x_name: "A", icon_url: "icon", approval_status: "approved", is_active: true }],
    canAccessAdmin: false,
    canAccessManage: false,
  });
});

test("X rows query failure -> 503 unavailable", async () => {
  const s = setup({ failOn: ["x_user_account_links"] });
  const res = await s.get();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { loggedIn: false, unavailable: true });
});

test("PRESETS_WITH_PERMISSIONS matches CURRENT presets.ts", async () => {
  const src = readFileSync(new URL("../../../src/lib/auth/permissions/presets.ts", import.meta.url), "utf8");
  const current = [...src.matchAll(/^  (\w+): \{\n(?:.*\n)*?    permissions: (\[[^\]]*\]),?$/gm)]
    .filter((m) => m[2].replace(/\s/g, "") !== "[]")
    .map((m) => m[1]);
  const { PRESETS_WITH_PERMISSIONS } = await import("../src/routes/account/summary.ts");
  assert.deepEqual([...PRESETS_WITH_PERMISSIONS].sort(), current.sort());
});

test("only GET is routed", async () => {
  const { get } = setup();
  const res = await app.request("http://localhost/api/account/summary", { method: "POST" }, { DB: {} });
  assert.equal(res.status, 404);
  assert.ok(get);
});

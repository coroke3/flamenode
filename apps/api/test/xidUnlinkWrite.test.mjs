import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createXIdUnlinkRoutes } from "../src/routes/xid/unlink.ts";
import { xidWriteStack } from "../src/routes/xid/index.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const USER = { id: "admin-1", name: "Admin", email: null, image: null,
  role: "user", is_banned: 0, active_x_user_id: "x_one" };

function setup({ linked = true, active = true, onFirst } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  seedBase(sqlite, { role: "user" });
  sqlite.exec(`
    ALTER TABLE x_user_account_links ADD COLUMN link_role TEXT DEFAULT 'owner';
    ALTER TABLE x_user_account_links ADD COLUMN created_by_request_id TEXT;
    ALTER TABLE x_user_account_links ADD COLUMN created_at INTEGER DEFAULT 1;
    ALTER TABLE x_user_account_links ADD COLUMN updated_at INTEGER DEFAULT 2;
    CREATE TABLE event_staff (id TEXT PRIMARY KEY, x_user_id TEXT, permission_preset TEXT);
    CREATE TABLE videos (id TEXT PRIMARY KEY, creator_x_user_id TEXT);
    CREATE TABLE slots (id TEXT PRIMARY KEY, x_user_id TEXT, reserved_by_user_id TEXT, status TEXT);
    CREATE TABLE x_identity_requests (
      id TEXT PRIMARY KEY, status TEXT, request_type TEXT,
      requested_by_auth_user_id TEXT, source_x_user_id TEXT, target_x_user_id TEXT
    );
  `);
  sqlite.prepare("INSERT INTO x_users (id,x_name,approval_status) VALUES ('x_one','Creator','approved')").run();
  if (linked) sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id,x_user_id) VALUES (?,?)")
    .run(USER.id, "x_one");
  if (active) sqlite.prepare('UPDATE "user" SET active_x_user_id=? WHERE id=?').run("x_one", USER.id);
  let sessionCalls = 0;
  const session = async (c, next) => {
    sessionCalls++;
    c.set("user", { ...USER, active_x_user_id: active ? "x_one" : null });
    c.set("sessionState", "user");
    await next();
  };
  const app = new Hono();
  app.route("/api/xid", createXIdUnlinkRoutes(xidWriteStack(session)));
  const send = ({ x_user_id = "x_one", confirm = "DELETE x_one", origin = SITE } = {}) =>
    app.request(SITE + "/api/xid/x_one", {
      method: "DELETE", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ x_user_id, confirm }),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  return { sqlite, stats, send, get sessionCalls() { return sessionCalls; } };
}

test("SA-103 isolated route unlinks a dependency-free X and clears active identity with two strict audits", async () => {
  const h = setup();
  const res = await h.send();
  assert.equal(res.status, 200, await res.text());
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM x_user_account_links").get().n, 0);
  assert.equal(h.sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id=?').get(USER.id).active_x_user_id, null);
  const audits = h.sqlite.prepare("SELECT * FROM audit_logs ORDER BY table_name").all();
  assert.deepEqual(audits.map(a => a.table_name), ["user", "x_user_account_links"]);
  for (const row of audits) assert.equal(row.actor_x_user_id, "x_one");
  assert.equal(JSON.parse(audits[1].before_json).link_role, "owner");
  assert.equal(audits[1].after_json, null);
  assert.equal(h.stats.batches, 1);
});

test("SA-103 isolated route preserves unrelated active X and writes only unlink audit", async () => {
  const h = setup({ active: false });
  const res = await h.send();
  assert.equal(res.status, 200, await res.text());
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM x_user_account_links").get().n, 0);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
  assert.equal(h.stats.batches, 1);
});

test("SA-103 isolated route denies dependencies and retains link and active-X", async () => {
  const mutators = [
    (db) => db.prepare("INSERT INTO event_staff (id,x_user_id,permission_preset) VALUES ('ev', 'x_one', 'owner')").run(),
    (db) => db.prepare("INSERT INTO videos (id,creator_x_user_id) VALUES ('vid','x_one')").run(),
    (db) => db.prepare("INSERT INTO slots (id,x_user_id,reserved_by_user_id,status) VALUES ('slot','x_one',?,'reserved')").run(USER.id),
    (db) => db.prepare("INSERT INTO x_identity_requests (id,status,request_type,requested_by_auth_user_id) VALUES ('req','pending','merge',?)").run(USER.id),
  ];
  for (const makeBlocker of mutators) {
    const h = setup();
    makeBlocker(h.sqlite);
    const res = await h.send();
    assert.equal(res.status, 409);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM x_user_account_links").get().n, 1);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
    assert.equal(h.stats.batches, 0);
  }
});

test("SA-103 isolated route rechecks new dependencies inside DELETE after preflight", async () => {
  let raced = false;
  const h = setup({ onFirst: (statement, sqlite) => {
    if (!raced && statement.includes("WITH actor AS")) {
      raced = true;
      sqlite.prepare("INSERT INTO slots (id,x_user_id,reserved_by_user_id,status) VALUES ('raced','x_one',?,'submitted')")
        .run(USER.id);
    }
  } });
  const res = await h.send();
  assert.equal(raced, true);
  assert.equal(res.status, 409);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM x_user_account_links").get().n, 1);
  assert.equal(h.sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id=?').get(USER.id).active_x_user_id, "x_one");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("SA-103 isolated route rejects invalid confirmation, unlinked account and foreign origin", async () => {
  const h = setup();
  const bad = await h.send({ confirm: "DELETE x_other" });
  assert.equal(bad.status, 400);
  assert.equal(h.stats.batches, 0);
  const noLink = setup({ linked: false });
  assert.equal((await noLink.send()).status, 403);
  const cross = setup();
  assert.equal((await cross.send({ origin: "https://evil.example" })).status, 403);
  assert.equal(cross.sessionCalls, 0);
  assert.equal(cross.stats.reads, 0);
});

test("SA-103 isolated unlink rolls back if the supposedly non-active X becomes active after preflight", async () => {
  let switched = false;
  const h = setup({ active: false, onFirst: (statement, sqlite) => {
    if (!switched && statement.includes("WITH actor AS")) {
      switched = true;
      sqlite.prepare('UPDATE "user" SET active_x_user_id=? WHERE id=?').run("x_one", USER.id);
    }
  } });
  const res = await h.send();
  assert.equal(switched, true, "active X must change between dependency read and DELETE");
  assert.equal(res.status, 409);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM x_user_account_links").get().n, 1);
  assert.equal(h.sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id=?').get(USER.id).active_x_user_id, "x_one");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

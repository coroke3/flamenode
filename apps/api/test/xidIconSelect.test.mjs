import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { xidWriteStack } from "../src/routes/xid/index.ts";
import { createXIdIconSelectRoutes } from "../src/routes/xid/iconSelect.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const USER = { id: "admin-1", name: "Admin", email: null, image: null,
  role: "user", is_banned: 0, active_x_user_id: null };

function setup({ linked = true, approved = true, onFirst } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  seedBase(sqlite, { role: "user" });
  sqlite.exec(`CREATE TABLE videos (
    id TEXT PRIMARY KEY, creator_x_user_id TEXT, creator_icon_url TEXT,
    visibility_status TEXT, created_at INTEGER
  )`);
  sqlite.prepare("INSERT INTO x_users (id,x_name,icon_url,approval_status) VALUES ('x_one','Creator',?,?)")
    .run("https://example.com/old.png", approved ? "approved" : "pending");
  if (linked) {
    sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id,x_user_id) VALUES (?,?)")
      .run(USER.id, "x_one");
  }
  for (const [id, url, visibility, created] of [
    ["v1", "https://example.com/new.png", "public", 20],
    ["v2", "https://example.com/private.png", "private", 30],
    ["v3", "https://example.com/new.png", "public", 10],
  ]) {
    sqlite.prepare("INSERT INTO videos (id,creator_x_user_id,creator_icon_url,visibility_status,created_at) VALUES (?,?,?,?,?)")
      .run(id, "x_one", url, visibility, created);
  }
  let sessionCalls = 0;
  const session = async (c, next) => {
    sessionCalls++;
    c.set("user", { ...USER });
    c.set("sessionState", "user");
    await next();
  };
  const app = new Hono();
  app.route("/api/xid", createXIdIconSelectRoutes(xidWriteStack(session)));
  const send = (icon_url, { x_user_id = "x_one", origin = SITE } = {}) =>
    app.request(SITE + "/api/xid/x_one/icon", {
      method: "PUT", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ x_user_id, icon_url }),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  return { sqlite, stats, send, get sessionCalls() { return sessionCalls; } };
}

test("SA-104 isolated route selects a public video icon and writes audit + rebuild batch", async () => {
  const h = setup();
  const res = await h.send("https://example.com/new.png");
  assert.equal(res.status, 200, await res.text());
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(h.sqlite.prepare("SELECT icon_url FROM x_users WHERE id='x_one'").get().icon_url,
    "https://example.com/new.png");
  const audit = h.sqlite.prepare("SELECT * FROM audit_logs WHERE table_name='x_users'").get();
  assert.ok(audit);
  assert.equal(audit.reason, "icon_select");
  assert.equal(audit.actor_user_id, USER.id);
  assert.equal(audit.actor_x_user_id, "x_one");
  assert.equal(JSON.parse(audit.before_json).icon_url, "https://example.com/old.png");
  assert.equal(JSON.parse(audit.after_json).icon_url, "https://example.com/new.png");
  assert.deepEqual(h.sqlite.prepare("SELECT target_type FROM static_rebuild_queue").all()
    .map(x => x.target_type).sort(), ["member_suggestions", "user", "users_index"]);
  assert.equal(h.stats.batches, 1);
});

test("SA-104 isolated route rejects foreign and private icons before any write", async () => {
  for (const url of ["https://evil.example/forged.png", "https://example.com/private.png", ""]) {
    const h = setup();
    const res = await h.send(url);
    assert.equal(res.status, 400);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
    assert.equal(h.stats.batches, 0);
  }
});

test("SA-104 isolated route rejects unlinked and unapproved identities", async () => {
  for (const config of [{ linked: false }, { approved: false }]) {
    const h = setup(config);
    const res = await h.send("https://example.com/new.png");
    assert.equal(res.status, 403);
    assert.equal(h.stats.batches, 0);
  }
});

test("SA-104 isolated route rejects revoked link and preserves atomic audit and queue state", async () => {
  let raced = false;
  const h = setup({ onFirst: (sql, sqlite) => {
    if (!raced && sql.includes("FROM x_users x") && sql.includes("_icon_candidates_json")) {
      raced = true;
      sqlite.prepare("DELETE FROM x_user_account_links WHERE auth_user_id = ?").run(USER.id);
    }
  } });
  const res = await h.send("https://example.com/new.png");
  assert.equal(raced, true);
  assert.equal(res.status, 409);
  assert.equal(h.sqlite.prepare("SELECT icon_url FROM x_users WHERE id='x_one'").get().icon_url,
    "https://example.com/old.png");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
});

test("SA-104 isolated route rejects cross-origin requests before session and D1", async () => {
  const h = setup();
  const res = await h.send("https://example.com/new.png", { origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.equal(h.sessionCalls, 0);
  assert.equal(h.stats.reads, 0);
});

// MIG-0654 U02: real Hono + atomic SQLite D1 adapter (not production D1).
// Tests use the same server-core mutation functions; CURRENT Next handlers remain mounted.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { registerStaffWriteRoutes } from "../src/routes/manage/staffWrite.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ADMIN = { id: "admin-1", name: "Admin", role: "admin", is_banned: 0 };
const VIEWER = { id: "viewer-1", name: "Viewer", role: "user", is_banned: 0 };
const upsert = (extra = {}) => ({
  display_name: "Added", x_user_id: "@added_user", permission_preset: "public_staff",
  reason: "staff update", ...extra,
});

function setup(user = ADMIN) {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite);
  seedEvent(sqlite);
  sqlite.exec(`
    ALTER TABLE x_user_account_links ADD COLUMN link_role TEXT;
    CREATE TABLE event_staff (
      id TEXT PRIMARY KEY, event_id TEXT, x_user_id TEXT, display_name TEXT,
      permission_preset TEXT, custom_permission_keys_json TEXT, is_public INTEGER,
      public_role_label TEXT, approved_by_auth_user_id TEXT, approved_at INTEGER,
      created_at INTEGER, updated_at INTEGER
    );
  `);
  sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES ('owner_x', 'Owner', 'approved')").run();
  sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id, x_user_id, link_role) VALUES ('admin-1', 'owner_x', 'owner')").run();
  sqlite.prepare(`INSERT INTO event_staff (id, event_id, x_user_id, display_name,
    permission_preset, is_public, created_at, updated_at)
    VALUES ('s-owner','ev-1','owner_x','Owner','owner',0,1,1)`).run();
  if (user.id === VIEWER.id) {
    sqlite.prepare('INSERT INTO "user" (id,name,role,is_banned,is_tos_accepted) VALUES (?,?,?,?,1)')
      .run(VIEWER.id, VIEWER.name, VIEWER.role, 0);
  }
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("db", drizzle(c.env.DB, { schema }));
    c.set("actorSnapshotJsonById", { [user.id]: JSON.stringify({ id: user.id, role: user.role }) });
    await next();
  });
  registerStaffWriteRoutes(app);
  assert.deepEqual(
    app.routes.filter((r) => ["POST", "PUT", "DELETE"].includes(r.method))
      .map((r) => [r.method, r.path]),
    [
      ["POST", "/events/:id/staff"],
      ["PUT", "/events/:id/staff/:staffId"],
      ["DELETE", "/events/:id/staff/:staffId"],
    ],
    "all staff mutations must be directly registered on canonical parent paths",
  );
  async function send(method, path, body) {
    return app.request("https://example.test/events/ev-1/staff" + (path === "/" ? "" : path), {
      method, headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, { DB: db });
  }
  const row = (id) => sqlite.prepare("SELECT * FROM event_staff WHERE id = ?").get(id);
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
  return { sqlite, stats, send, row, count };
}

test("U02: POST creates pending X + staff and strict audits; PUT updates same staff", async () => {
  const s = setup();
  const create = await s.send("POST", "/", upsert());
  assert.equal(create.status, 200, await create.clone().text());
  assert.deepEqual(await create.json(), { ok: true, pendingPublicReflection: true });
  const added = s.sqlite.prepare("SELECT * FROM event_staff WHERE x_user_id='added_user'").get();
  assert.equal(added.display_name, "Added");
  assert.equal(added.permission_preset, "public_staff");
  assert.equal(s.sqlite.prepare("SELECT approval_status FROM x_users WHERE id='added_user'").get().approval_status, "pending");
  assert.equal(s.count("audit_logs"), 2, "X creation and staff creation are audited");
  assert.ok(s.count("static_rebuild_queue") >= 4, "projection intents persisted");
  const update = await s.send("PUT", "/"+added.id, upsert({
    staff_id: added.id, display_name: "Edited", permission_preset: "reviewer",
  }));
  assert.equal(update.status, 200, await update.clone().text());
  assert.equal(s.row(added.id).display_name, "Edited");
  assert.equal(s.row(added.id).permission_preset, "reviewer");
  assert.equal(s.count("audit_logs"), 3);
});

test("U02: DELETE is idempotent, non-owner can be removed, last operable owner stays", async () => {
  const s = setup();
  const created = await s.send("POST", "/", upsert({ x_user_id: "other_staff" }));
  assert.equal(created.status, 200, await created.clone().text());
  const row = s.sqlite.prepare("SELECT id FROM event_staff WHERE x_user_id='other_staff'").get();
  const del = await s.send("DELETE", "/"+row.id, { reason: "remove" });
  assert.equal(del.status, 200, await del.clone().text());
  assert.equal(s.row(row.id), undefined);
  assert.equal(s.count("audit_logs"), 3, "pending X creation, staff creation, staff deletion");
  const repeat = await s.send("DELETE", "/"+row.id, { reason: "remove" });
  assert.equal(repeat.status, 200, await repeat.clone().text());
  assert.deepEqual(await repeat.json(), { ok: true });
  const owner = await s.send("DELETE", "/s-owner", { reason: "remove" });
  assert.notEqual(owner.status, 200);
  assert.ok(s.row("s-owner"), "owner deletion fails closed");
});

test("U02: wrong event/staff identity and unauthorized requester cannot mutate", async () => {
  const s = setup(VIEWER);
  const denied = await s.send("POST", "/", upsert());
  assert.equal(denied.status, 403, await denied.clone().text());
  assert.equal(s.count("audit_logs"), 0);
  const admin = setup();
  const mismatch = await admin.send("PUT", "/s-owner", upsert({ staff_id: "some-other-staff" }));
  assert.equal(mismatch.status, 400);
  assert.equal(admin.count("audit_logs"), 0);
  const absent = await admin.send("PUT", "/missing", upsert());
  assert.equal(absent.status, 404);
  assert.equal(admin.count("audit_logs"), 0);
});

test("U02: non-admin cannot assign privileged presets; invalid URL ID rejects", async () => {
  const s = setup(VIEWER);
  const privileged = await s.send("POST", "/", upsert({ permission_preset: "xid_reviewer" }));
  assert.equal(privileged.status, 403, "unprivileged actor is rejected before mutation");
  const admin = setup();
  const invalid = await admin.send("PUT", "/bad%20id", upsert());
  assert.equal(invalid.status, 400);
  assert.equal(admin.count("audit_logs"), 0);
});

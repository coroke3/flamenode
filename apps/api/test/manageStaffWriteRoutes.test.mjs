// MIG-0654 U02: real Hono + atomic SQLite D1 adapter (not production D1).
// Tests use the same server-core mutation functions; CURRENT Next handlers remain mounted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
      ["POST", "/events/:id/owner-transfer"],
      ["POST", "/events/:id/staff/csv"],
      ["POST", "/events/:id/staff"],
      ["PUT", "/events/:id/staff/:staffId"],
      ["DELETE", "/events/:id/staff/:staffId"],
    ],
    "all staff mutations must be directly registered on canonical parent paths",
  );
  async function send(method, path, body) {
    const url = path === "/owner-transfer"
      ? "https://example.test/events/ev-1/owner-transfer"
      : "https://example.test/events/ev-1/staff" + (path === "/" ? "" : path);
    return app.request(url, {
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

test("U02: PUT rejects a canonical X collision with a different staff record", async () => {
  const s = setup();
  const first = await s.send("POST", "/", upsert({ x_user_id: "@first_user" }));
  assert.equal(first.status, 200, await first.clone().text());
  const second = await s.send("POST", "/", upsert({ x_user_id: "second_user" }));
  assert.equal(second.status, 200, await second.clone().text());
  const staff1 = s.sqlite.prepare("SELECT * FROM event_staff WHERE x_user_id='first_user'").get();
  const staff2 = s.sqlite.prepare("SELECT * FROM event_staff WHERE x_user_id='second_user'").get();
  const auditCount = s.count("audit_logs");
  const collision = await s.send("PUT", "/" + staff1.id, upsert({
    staff_id: staff1.id, x_user_id: "@SECOND_USER", display_name: "Must not overwrite",
  }));
  assert.equal(collision.status, 409, await collision.clone().text());
  assert.equal(s.row(staff1.id).x_user_id, "first_user");
  assert.equal(s.row(staff2.id).x_user_id, "second_user");
  assert.equal(s.count("audit_logs"), auditCount, "rejected identity reassignment has no audit writes");
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


test("U03: CSV creates staff with pending X IDs, atomic audits and projection", async () => {
  const s = setup();
  const csv = (rows) => ({
    reason: "CSV onboarding",
    rows: rows.map((x_user_id, i) => ({
      lineNumber: i + 2, display_name: "CSV " + i, x_user_id,
      permission_preset: "public_staff", permission_keys: [],
      is_public_staff: "1", public_role_label: "",
    })),
  });
  const result = await s.send("POST", "/csv", csv(["first_csv", "@SECOND_CSV"]));
  assert.equal(result.status, 200, await result.clone().text());
  assert.deepEqual(await result.json(), { ok: true, pendingPublicReflection: true });
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff WHERE x_user_id IN ('first_csv', 'second_csv')").get().n, 2);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id IN ('first_csv', 'second_csv') AND approval_status='pending'").get().n, 2);
  assert.equal(s.count("audit_logs"), 4, "two X creations and two staff creations are audited");
  assert.ok(s.count("static_rebuild_queue") >= 4);
});

test("U03: CSV updates an existing non-owner staff row without creating a second X identity", async () => {
  const s = setup();
  const created = await s.send("POST", "/", upsert({ x_user_id: "existing_csv" }));
  assert.equal(created.status, 200, await created.clone().text());
  const prior = s.sqlite.prepare("SELECT * FROM event_staff WHERE x_user_id='existing_csv'").get();
  const beforeAuditCount = s.count("audit_logs");
  const update = await s.send("POST", "/csv", {
    reason: "CSV revise",
    rows: [{
      lineNumber: 2, display_name: "CSV Edited", x_user_id: "@EXISTING_CSV",
      permission_preset: "reviewer", permission_keys: [],
      is_public_staff: "1", public_role_label: "Reviewer",
    }],
  });
  assert.equal(update.status, 200, await update.clone().text());
  const after = s.row(prior.id);
  assert.equal(after.display_name, "CSV Edited");
  assert.equal(after.permission_preset, "reviewer");
  assert.equal(after.x_user_id, "existing_csv");
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='existing_csv'").get().n, 1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff WHERE x_user_id='existing_csv'").get().n, 1);
  assert.equal(s.count("audit_logs"), beforeAuditCount + 1);
});

test("U03: CSV rejects canonical duplicates, owner edits and oversized atomic batches before writes", async () => {
  const s = setup();
  const row = (id, lineNumber) => ({
    lineNumber, display_name: "CSV Staff", x_user_id: id,
    permission_preset: "public_staff", permission_keys: [],
    is_public_staff: "0", public_role_label: "",
  });
  const dup = await s.send("POST", "/csv", { reason: "import", rows: [row("@REPEATED", 2), row("repeated", 3)] });
  assert.equal(dup.status, 409, await dup.clone().text());
  assert.equal(s.count("audit_logs"), 0);
  const owner = await s.send("POST", "/csv", {
    reason: "import", rows: [{ ...row("owner_x", 2), permission_preset: "owner" }],
  });
  assert.notEqual(owner.status, 200);
  assert.equal(s.row("s-owner").permission_preset, "owner");
  assert.equal(s.count("audit_logs"), 0);
  const rows = Array.from({ length: 100 }, (_, i) => row("csv_" + i, i + 2));
  const tooLarge = await s.send("POST", "/csv", { reason: "import", rows });
  assert.equal(tooLarge.status, 400, await tooLarge.clone().text());
  assert.equal(s.count("audit_logs"), 0);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff").get().n, 1);
});

test("U03: authorized non-admin cannot delegate site-admin-only X reviewer grants via CSV", async () => {
  const s = setup(VIEWER);
  s.sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES ('delegate_x', 'Delegate', 'approved')").run();
  s.sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id, x_user_id, link_role) VALUES (?, 'delegate_x', 'owner')").run(VIEWER.id);
  s.sqlite.prepare(`INSERT INTO event_staff
    (id, event_id, x_user_id, display_name, permission_preset,
     custom_permission_keys_json, is_public, created_at, updated_at)
    VALUES ('s-delegate', 'ev-1', 'delegate_x', 'Delegate', 'custom',
     '["event.members"]', 0, 1, 1)`).run();

  const payload = (preset, keys) => ({
    reason: "delegated CSV import",
    rows: [{
      lineNumber: 2, display_name: "Restricted Staff", x_user_id: "restricted_csv",
      permission_preset: preset, permission_keys: keys,
      is_public_staff: "0", public_role_label: "",
    }],
  });
  const first = await s.send("POST", "/csv", payload("xid_reviewer", []));
  assert.equal(first.status, 400);
  const second = await s.send("POST", "/csv", payload("custom", ["xid.link_requests"]));
  assert.equal(second.status, 400);
  assert.equal(s.count("audit_logs"), 0, "denied grants must never reach the atomic batch");
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='restricted_csv'").get().n, 0);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff WHERE x_user_id='restricted_csv'").get().n, 0);

  const permitted = await s.send("POST", "/csv", payload("public_staff", []));
  assert.equal(permitted.status, 200, await permitted.clone().text());
  assert.equal(s.sqlite.prepare("SELECT permission_preset FROM event_staff WHERE x_user_id='restricted_csv'").get().permission_preset, "public_staff");
  assert.equal(s.count("audit_logs"), 2, "allowed pending-X and staff creation must be audited");
});

test("U04: owner-transfer is in the parent Origin/session/writeGuard/DB guarded paths", async () => {
  const source = await readFile(new URL("../src/routes/manage/index.ts", import.meta.url), "utf8");
  assert.match(source, /const staffWritePaths = \[[^\n]*"\/events\/:id\/owner-transfer"\]/);
  const origin = source.indexOf("originGuardMiddleware(");
  const session = source.indexOf('sessionMiddleware()');
  const write = source.indexOf("writeGuardMiddleware(");
  const db = source.indexOf("onlyMutating(dbMiddleware)");
  const handler = source.indexOf("registerStaffWriteRoutes(manageRoutes)");
  assert.ok(origin >= 0 && origin < session && session < write && write < db && db < handler);
});

test("U04: owner transfer denies missing confirmation and atomically moves owner role", async () => {
  const s = setup();
  s.sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES ('target_x','Target','approved')").run();
  s.sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id, x_user_id, link_role) VALUES ('admin-1','target_x','owner')").run();
  s.sqlite.prepare(`INSERT INTO event_staff (id,event_id,x_user_id,display_name,permission_preset,is_public,created_at,updated_at)
    VALUES ('s-target','ev-1','target_x','Target','reviewer',0,1,1)`).run();
  const transfer = (overrides = {}) => ({
    from_staff_id: "s-owner",
    to_staff_id: "s-target",
    reason: "authorized handover",
    confirm_text: "TRANSFER ev-1",
    self_confirm_text: "SELF CHANGE ev-1",
    ...overrides,
  });
  const missingConfirm = await s.send("POST", "/owner-transfer", transfer({ confirm_text: "TRANSFER other" }));
  assert.notEqual(missingConfirm.status, 200);
  assert.equal(s.row("s-owner").permission_preset, "owner");
  assert.equal(s.count("audit_logs"), 0);
  const missingSelf = await s.send("POST", "/owner-transfer", transfer({ self_confirm_text: "" }));
  assert.notEqual(missingSelf.status, 200);
  assert.equal(s.row("s-owner").permission_preset, "owner");
  assert.equal(s.count("audit_logs"), 0);
  const success = await s.send("POST", "/owner-transfer", transfer());
  assert.equal(success.status, 200, await success.clone().text());
  assert.deepEqual(await success.json(), { ok: true, pendingPublicReflection: true });
  assert.equal(s.row("s-owner").permission_preset, "manager");
  assert.equal(s.row("s-target").permission_preset, "owner");
  assert.equal(s.count("audit_logs"), 2, "both sides of the transfer must be audited");
  assert.ok(s.count("static_rebuild_queue") >= 4);
  const replay = await s.send("POST", "/owner-transfer", transfer());
  assert.notEqual(replay.status, 200, "the original staff is no longer owner");
  assert.equal(s.count("audit_logs"), 2, "replay must not write audit logs");
});

test("U04: owner transfer rejects missing staff, identical ids, or unprivileged actors", async () => {
  const admin = setup();
  const payload = { from_staff_id: "s-owner", to_staff_id: "s-owner",
    reason: "invalid", confirm_text: "TRANSFER ev-1" };
  const same = await admin.send("POST", "/owner-transfer", payload);
  assert.equal(same.status, 400);
  assert.equal(admin.count("audit_logs"), 0);
  const absent = await admin.send("POST", "/owner-transfer", {
    ...payload, to_staff_id: "missing",
  });
  assert.notEqual(absent.status, 200);
  assert.equal(admin.count("audit_logs"), 0);
  const viewer = setup(VIEWER);
  const denied = await viewer.send("POST", "/owner-transfer", {
    ...payload, to_staff_id: "s-target",
  });
  assert.equal(denied.status, 403);
  assert.equal(viewer.count("audit_logs"), 0);
});

test("U02: GET staff reader is unaffected by the write-only CostGuard", async () => {
  const app = new Hono();
  // Register the write middleware BEFORE the read handler: a missing D1
  // binding would produce 503 if its CostGuard accidentally intercepted GET.
  registerStaffWriteRoutes(app);
  app.get("/events/:id/staff", (c) => c.json({ ok: true, id: c.req.param("id") }));
  const result = await app.request("https://example.test/events/ev-1/staff", { method: "GET" });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, id: "ev-1" });
});

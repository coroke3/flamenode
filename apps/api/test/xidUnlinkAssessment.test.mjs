import assert from "node:assert/strict";
import test from "node:test";
import { assessXUnlinkD1 } from "../src/routes/xid/unlinkAssessment.ts";
import { createAdminD1 } from "./helpers/sqliteD1.mjs";

const ACTOR = "admin-1", XID = "x_one";
function setup() {
  const { db, sqlite, stats } = createAdminD1();
  sqlite.exec(`
    ALTER TABLE x_user_account_links ADD COLUMN link_role TEXT DEFAULT 'owner';
    CREATE TABLE event_staff (id TEXT PRIMARY KEY, x_user_id TEXT, permission_preset TEXT);
    CREATE TABLE videos (id TEXT PRIMARY KEY, creator_x_user_id TEXT);
    CREATE TABLE slots (id TEXT PRIMARY KEY, x_user_id TEXT, reserved_by_user_id TEXT, status TEXT);
    CREATE TABLE x_identity_requests (
      id TEXT PRIMARY KEY, status TEXT, request_type TEXT,
      requested_by_auth_user_id TEXT, source_x_user_id TEXT, target_x_user_id TEXT
    );
  `);
  sqlite.prepare("INSERT INTO x_users (id,x_name,approval_status) VALUES (?,?,?)")
    .run(XID, "Creator", "approved");
  sqlite.prepare("INSERT INTO x_user_account_links (x_user_id,auth_user_id,link_role) VALUES (?,?,?)")
    .run(XID, ACTOR, "owner");
  const probe = () => assessXUnlinkD1(db, ACTOR, XID);
  return { db, sqlite, stats, probe };
}

test("SA-103 read-only probe allows a link with no dependencies, denies an absent link", async () => {
  const h = setup();
  assert.deepEqual(await h.probe(), { linked: true, allowed: true, blockers: [], message: null });
  h.sqlite.prepare("DELETE FROM x_user_account_links WHERE x_user_id=?").run(XID);
  assert.deepEqual(await h.probe(), { linked: false, allowed: false, blockers: [], message: null });
  assert.equal(h.stats.batches, 0);
  assert.equal(h.stats.reads, 2, "one bounded D1 read per dependency probe");
});

test("SA-103 probe blocks last approved owner if X is event owner, unless another approved owner manages it", async () => {
  const h = setup();
  h.sqlite.prepare("INSERT INTO event_staff (id,x_user_id,permission_preset) VALUES ('es1',?,'owner')").run(XID);
  let state = await h.probe();
  assert.equal(state.allowed, false);
  assert.ok(state.blockers.includes("event_owner_inoperable"));
  assert.ok(state.blockers.includes("only_approved_link_with_dependencies"));
  h.sqlite.prepare("INSERT INTO x_user_account_links (x_user_id,auth_user_id,link_role) VALUES (?,?,?)")
    .run(XID, "another-owner", "owner");
  state = await h.probe();
  assert.ok(!state.blockers.includes("event_owner_inoperable"),
    "other owner role retains event operability");
});

test("SA-103 probe protects video creators, but allows deletion with another approved linked X", async () => {
  const h = setup();
  h.sqlite.prepare("INSERT INTO videos (id,creator_x_user_id) VALUES ('v1',?)").run(XID);
  let state = await h.probe();
  assert.deepEqual(state.blockers, ["creator_assets_without_alternative", "only_approved_link_with_dependencies"]);
  h.sqlite.prepare("INSERT INTO x_users (id,x_name,approval_status) VALUES ('x_two','Other','approved')").run();
  h.sqlite.prepare("INSERT INTO x_user_account_links (x_user_id,auth_user_id) VALUES ('x_two',?)").run(ACTOR);
  state = await h.probe();
  assert.deepEqual(state, { linked: true, allowed: true, blockers: [], message: null });
  h.sqlite.prepare("UPDATE x_users SET approval_status='pending' WHERE id='x_two'").run();
  assert.equal((await h.probe()).allowed, false, "an unapproved fallback cannot make unlink safe");
});

test("SA-103 probe blocks actor reservations and pending merge/revert, ignoring unrelated cases", async () => {
  const h = setup();
  h.sqlite.prepare("INSERT INTO slots (id,x_user_id,reserved_by_user_id,status) VALUES ('s1',?,?,'reserved')").run(XID, ACTOR);
  h.sqlite.prepare("INSERT INTO x_identity_requests (id,status,request_type,requested_by_auth_user_id) VALUES ('r1','pending','merge',?)").run(ACTOR);
  const state = await h.probe();
  assert.deepEqual(state.blockers, ["reserved_or_submitted_slot", "pending_merge_request"]);
  h.sqlite.prepare("UPDATE slots SET reserved_by_user_id='unrelated' WHERE id='s1'").run();
  h.sqlite.prepare("UPDATE x_identity_requests SET status='done' WHERE id='r1'").run();
  assert.deepEqual((await h.probe()).blockers, []);
  h.sqlite.prepare("UPDATE slots SET reserved_by_user_id=?, status='submitted' WHERE id='s1'").run(ACTOR);
  assert.deepEqual((await h.probe()).blockers, ["reserved_or_submitted_slot"]);
});

test("SA-103 probe keeps first matching CURRENT blocker message and does not write", async () => {
  const h = setup();
  h.sqlite.prepare("INSERT INTO event_staff (id,x_user_id,permission_preset) VALUES ('es2',?,'owner')").run(XID);
  const state = await h.probe();
  assert.equal(state.blockers[0], "event_owner_inoperable");
  assert.equal(state.message, "この X ID はイベント代表者として残す必要があるため、連携を削除できません。");
  assert.equal(h.stats.batches, 0);
});

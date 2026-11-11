import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { loadAuthorizedPermissionVideo } from "../src/video/permissionAccess.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE videos (
      id TEXT PRIMARY KEY, title TEXT, primary_event_id TEXT,
      creator_x_user_id TEXT, submitted_by_user_id TEXT, visibility_status TEXT
    );
    CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT);
    CREATE TABLE x_user_account_links (
      auth_user_id TEXT, x_user_id TEXT
    );
    CREATE TABLE video_members (
      id TEXT PRIMARY KEY, video_id TEXT, x_user_id TEXT, can_edit INTEGER
    );
    CREATE TABLE video_events (video_id TEXT, event_id TEXT);
    CREATE TABLE system_settings (
      id TEXT PRIMARY KEY,
      default_editable_fields TEXT,
      upcoming_editable_fields TEXT
    );
    CREATE TABLE event_staff (
      event_id TEXT, x_user_id TEXT, permission_preset TEXT,
      custom_permission_keys_json TEXT
    );
    INSERT INTO videos VALUES ('v1','Video',NULL,'alice',NULL,'private');
  `);
  const queries = [];
  const d1 = {
    prepare(query) {
      queries.push(query);
      return {
        bind(...params) {
          return {
            async raw() {
              const stmt = sqlite.prepare(query);
              stmt.setReturnArrays(true);
              try { return stmt.all(...params).map(row => [...row]); }
              finally { stmt.setReturnArrays(false); }
            },
          };
        },
      };
    },
  };
  return { sqlite, queries, db: drizzle(d1, { schema }) };
}

test("SA-082 shared authorization fails closed for missing video before ownership reads", async () => {
  const f = fixture();
  try {
    assert.equal(await loadAuthorizedPermissionVideo(f.db, { id: "admin", role: "admin" }, "missing", ""), null);
    assert.equal(f.queries.length, 1);
  } finally { f.sqlite.close(); }
});

test("SA-082 explicit privilege never falls back, but empty legacy mode may use admin", async () => {
  const f = fixture();
  try {
    const admin = { id: "admin", role: "admin" };
    const explicitAdmin = await loadAuthorizedPermissionVideo(f.db, admin, "v1", "admin");
    assert.equal(explicitAdmin?.privilegeMode, "admin");
    assert.equal(explicitAdmin?.submitted_by_user_id, "");
    assert.equal(await loadAuthorizedPermissionVideo(f.db, admin, "v1", "normal"), null);
    assert.equal(await loadAuthorizedPermissionVideo(f.db, admin, "v1", "event"), null);
    assert.equal((await loadAuthorizedPermissionVideo(f.db, admin, "v1", ""))?.privilegeMode, "admin");
  } finally { f.sqlite.close(); }
});

test("SA-082 normal owner requires approved linked creator X; role alone is never ownership", async () => {
  const f = fixture();
  try {
    const actor = { id: "u1", role: "user" };
    assert.equal(await loadAuthorizedPermissionVideo(f.db, actor, "v1", "normal"), null);
    f.sqlite.exec(`
      INSERT INTO x_users VALUES ('alice', 'approved');
      INSERT INTO x_user_account_links VALUES ('u1', 'alice');
    `);
    assert.equal(
      (await loadAuthorizedPermissionVideo(f.db, actor, "v1", "normal"))?.privilegeMode,
      "normal",
    );
    f.sqlite.exec("UPDATE x_users SET approval_status='rejected' WHERE id='alice'");
    assert.equal(await loadAuthorizedPermissionVideo(f.db, actor, "v1", "normal"), null);
  } finally { f.sqlite.close(); }
});

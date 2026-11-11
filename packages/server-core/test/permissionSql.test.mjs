import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  buildHiddenEditorCountGuardSql,
  buildHiddenMemberBulkDeleteSql,
  buildMemberPermissionBulkUpdateSql,
  buildPermissionSetGuardSql,
  buildXUsersBulkInsertSql,
} from "../src/video/permissionSql.ts";

const dialect = new SQLiteSyncDialect();
const COLS = [
  "id", "video_id", "x_user_id", "name", "role", "comment",
  "order_index", "can_edit", "is_public_member",
  "edit_granted_by_auth_user_id", "edit_granted_at", "edit_updated_at",
];
const member = (id, videoId, xId, overrides = {}) => ({
  id, video_id: videoId, x_user_id: xId, name: id, role: null, comment: null,
  order_index: 0, can_edit: 1, is_public_member: 1,
  edit_granted_by_auth_user_id: null, edit_granted_at: null,
  edit_updated_at: null, ...overrides,
});

function world() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE video_members (" + COLS.map((c) => (
    '"' + c + '" ' + (["order_index", "can_edit", "is_public_member",
      "edit_granted_at", "edit_updated_at"].includes(c) ? "INTEGER" : "TEXT")
  )).join(", ") + ")");
  const add = (row) => sqlite.prepare(
    "INSERT INTO video_members (" + COLS.join(", ") + ") VALUES (" +
      COLS.map(() => "?").join(", ") + ")",
  ).run(...COLS.map((key) => row[key]));
  const execGuard = (condition) => {
    const query = dialect.sqlToQuery(condition);
    return sqlite.prepare(query.sql).get(...query.params);
  };
  return { sqlite, add, execGuard };
}

test("MIG-0650 SA-082..084: CAS guard ignores other videos, but detects a changed member", () => {
  const w = world();
  try {
    const before = member("m1", "v1", "ALICE");
    w.add(before);
    w.add(member("m2", "v2", "alice"));
    const guard = buildPermissionSetGuardSql("v1", ["alice"], [before]);
    assert.doesNotThrow(() => w.execGuard(guard));
    w.sqlite.prepare("UPDATE video_members SET can_edit = 0 WHERE id = 'm1'").run();
    assert.throws(() => w.execGuard(guard), /./, "changed permission snapshot must fail closed");
    w.sqlite.prepare("UPDATE video_members SET can_edit = 1 WHERE id = 'm1'").run();
    assert.doesNotThrow(() => w.execGuard(guard));
    w.add(member("m3", "v1", "alice"));
    assert.throws(() => w.execGuard(guard), /./, "concurrent member insertion must fail CAS");
  } finally {
    w.sqlite.close();
  }
});

test("MIG-0650 SA-082..084: empty selected X IDs match no rows, case-insensitive selection", () => {
  const w = world();
  try {
    w.add(member("m1", "v1", "BoB"));
    assert.doesNotThrow(() => w.execGuard(buildPermissionSetGuardSql("v1", [], [])));
    assert.doesNotThrow(() => w.execGuard(buildPermissionSetGuardSql(
      "v1", ["bOb"], [member("m1", "v1", "BoB")],
    )));
    assert.throws(() => w.execGuard(buildPermissionSetGuardSql(
      "v1", ["BoB"], [],
    )), /./, "empty expected snapshot must not authorize a real row");
  } finally {
    w.sqlite.close();
  }
});

test("MIG-0650 SA-082..084: hidden editor count is an atomic fail-closed precondition", () => {
  const w = world();
  try {
    w.add(member("p1", "v1", "public", { is_public_member: 1 }));
    w.add(member("h1", "v1", "secret", { is_public_member: 0 }));
    w.add(member("other", "v2", "secret", { is_public_member: 0 }));
    const guard = buildHiddenEditorCountGuardSql("v1", 1);
    assert.doesNotThrow(() => w.execGuard(guard));
    w.add(member("h2", "v1", "second", { is_public_member: 0 }));
    assert.throws(() => w.execGuard(guard), /./, "hidden editor race must fail closed");
    assert.doesNotThrow(() => w.execGuard(buildHiddenEditorCountGuardSql("v1", 2)));
  } finally {
    w.sqlite.close();
  }
});

test("MIG-0650 SA-082..084: bulk permission patch updates only listed rows", () => {
  const w = world();
  try {
    w.add(member("m1", "v1", "alice"));
    w.add(member("m2", "v1", "bob"));
    w.add(member("m3", "v2", "alice"));
    const after = member("m1", "v1", "alice", {
      can_edit: 0, edit_updated_at: 1730000000,
    });
    const q = dialect.sqlToQuery(buildMemberPermissionBulkUpdateSql([after]));
    const result = w.sqlite.prepare(q.sql).run(...q.params);
    assert.equal(result.changes, 1);
    assert.deepEqual(
      w.sqlite.prepare("SELECT id, can_edit FROM video_members ORDER BY id").all().map((row) => ({ ...row })),
      [{ id: "m1", can_edit: 0 }, { id: "m2", can_edit: 1 }, { id: "m3", can_edit: 1 }],
    );
    const empty = dialect.sqlToQuery(buildMemberPermissionBulkUpdateSql([]));
    assert.equal(w.sqlite.prepare(empty.sql).run(...empty.params).changes, 0);
  } finally {
    w.sqlite.close();
  }
});

test("MIG-0650 SA-082..084: hidden removal is bounded by video ID and public flag", () => {
  const w = world();
  try {
    w.add(member("public", "v1", "alice"));
    w.add(member("hidden", "v1", "bob", { is_public_member: 0 }));
    w.add(member("elsewhere", "v2", "carol", { is_public_member: 0 }));
    const q = dialect.sqlToQuery(buildHiddenMemberBulkDeleteSql(
      "v1", ["hidden", "public", "elsewhere"],
    ));
    assert.equal(w.sqlite.prepare(q.sql).run(...q.params).changes, 1);
    assert.deepEqual(
      w.sqlite.prepare("SELECT id FROM video_members ORDER BY id").all().map((row) => ({ ...row })),
      [{ id: "elsewhere" }, { id: "public" }],
    );
    const empty = dialect.sqlToQuery(buildHiddenMemberBulkDeleteSql("v1", []));
    assert.equal(w.sqlite.prepare(empty.sql).run(...empty.params).changes, 0);
  } finally {
    w.sqlite.close();
  }
});

test("MIG-0650 SA-082..084: X profile bulk upsert never revives rejected status", () => {
  const w = world();
  try {
    w.sqlite.exec(`CREATE TABLE x_users (
      id TEXT PRIMARY KEY, x_name TEXT, icon_url TEXT, profile_text TEXT,
      portfolio_contact TEXT, youtube_channel_url TEXT, other_social_links TEXT,
      creative_start_date TEXT, approval_status TEXT
    )`);
    w.sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)")
      .run("rejected", "Original", "rejected");
    const inserts = [
      { id: "rejected", x_name: "Overwritten", approval_status: "pending" },
      { id: "new", x_name: "New", approval_status: "pending" },
    ];
    const q = dialect.sqlToQuery(buildXUsersBulkInsertSql(inserts));
    w.sqlite.prepare(q.sql).run(...q.params);
    assert.deepEqual(
      w.sqlite.prepare("SELECT id, x_name, approval_status FROM x_users ORDER BY id").all().map((row) => ({ ...row })),
      [
        { id: "new", x_name: "New", approval_status: "pending" },
        { id: "rejected", x_name: "Original", approval_status: "rejected" },
      ],
    );
    const repeat = w.sqlite.prepare(q.sql).run(...q.params);
    assert.ok(repeat.changes <= 1, "rejected X identity must not be overwritten");
    assert.deepEqual(
      w.sqlite.prepare("SELECT id, x_name, approval_status FROM x_users ORDER BY id").all().map((row) => ({ ...row })),
      [
        { id: "new", x_name: "New", approval_status: "pending" },
        { id: "rejected", x_name: "Original", approval_status: "rejected" },
      ],
      "repeated upsert must not change the rejected or existing identity",
    );
  } finally {
    w.sqlite.close();
  }
});

test("MIG-0650 SA-082..084: stale permission CAS aborts an entire SQLite mutation transaction", () => {
  const w = world();
  try {
    const before = member("member-1", "video-1", "alice");
    w.add(before);
    w.sqlite.exec("CREATE TABLE notification_outbox (id TEXT PRIMARY KEY)");
    const stale = buildPermissionSetGuardSql("video-1", ["alice"], [before]);
    w.sqlite.exec("UPDATE video_members SET can_edit = 0 WHERE id = 'member-1'");

    w.sqlite.exec("BEGIN");
    try {
      // An earlier write must also be undone when an in-batch CAS fails.
      w.sqlite.exec("INSERT INTO notification_outbox (id) VALUES ('pending-notice')");
      assert.throws(() => w.execGuard(stale), /./);
      w.sqlite.exec("COMMIT");
      assert.fail("the stale CAS transaction must not commit");
    } catch (error) {
      w.sqlite.exec("ROLLBACK");
      if (error?.message === "the stale CAS transaction must not commit") throw error;
    }
    assert.deepEqual(w.sqlite.prepare("SELECT id FROM notification_outbox").all(), []);
    assert.equal(
      w.sqlite.prepare("SELECT can_edit FROM video_members WHERE id = ?").get("member-1").can_edit,
      0,
      "the concurrent update must remain, rather than being overwritten",
    );
  } finally {
    w.sqlite.close();
  }
});

test("MIG-0650 SA-082..084: exact permission CAS permits the matched SQLite write transaction", () => {
  const w = world();
  try {
    const before = member("member-1", "video-1", "alice");
    const after = member("member-1", "video-1", "alice", { can_edit: 0 });
    w.add(before);
    const query = dialect.sqlToQuery(buildMemberPermissionBulkUpdateSql([after]));
    w.sqlite.exec("BEGIN");
    try {
      w.execGuard(buildPermissionSetGuardSql("video-1", ["ALICE"], [before]));
      assert.equal(w.sqlite.prepare(query.sql).run(...query.params).changes, 1);
      w.sqlite.exec("COMMIT");
    } catch (error) {
      w.sqlite.exec("ROLLBACK");
      throw error;
    }
    assert.equal(
      w.sqlite.prepare("SELECT can_edit FROM video_members WHERE id = ?").get("member-1").can_edit,
      0,
    );
  } finally {
    w.sqlite.close();
  }
});

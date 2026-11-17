import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  buildHiddenCarryRowsGuardSql,
  buildHiddenCarryRowsDeleteSql,
} from "../src/video/hiddenMemberCarrySql.ts";

const dialect = new SQLiteSyncDialect();

function member(id, changes = {}) {
  return {
    id,
    video_id: "v1",
    x_user_id: "alice",
    name: "Alice",
    role: "editor",
    comment: null,
    order_index: 0,
    can_edit: 1,
    is_public_member: 0,
    edit_granted_by_auth_user_id: "admin",
    edit_granted_at: 123,
    edit_updated_at: 456,
    ...changes,
  };
}

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE video_members (" +
    "id TEXT PRIMARY KEY, video_id TEXT NOT NULL, x_user_id TEXT," +
    "name TEXT NOT NULL, role TEXT, comment TEXT, order_index INTEGER NOT NULL," +
    "can_edit INTEGER NOT NULL, is_public_member INTEGER NOT NULL," +
    "edit_granted_by_auth_user_id TEXT, edit_granted_at INTEGER, edit_updated_at INTEGER);"
  );
  return db;
}

function insert(db, row) {
  db.prepare(
    "INSERT INTO video_members (id, video_id, x_user_id, name, role, comment," +
    "order_index, can_edit, is_public_member, edit_granted_by_auth_user_id," +
    "edit_granted_at, edit_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    row.id, row.video_id, row.x_user_id, row.name, row.role, row.comment,
    row.order_index, row.can_edit, row.is_public_member,
    row.edit_granted_by_auth_user_id, row.edit_granted_at, row.edit_updated_at,
  );
}

function compile(statement) {
  return dialect.sqlToQuery(statement);
}
function guard(db, videoId, rows) {
  const { sql, params } = compile(buildHiddenCarryRowsGuardSql(videoId, rows));
  return db.prepare(sql).get(...params);
}
function clean(db, videoId, rows) {
  const { sql, params } = compile(buildHiddenCarryRowsDeleteSql(videoId, rows));
  return db.prepare(sql).run(...params);
}

test("MIG-0650 U03d-2d: exact hidden snapshot succeeds with reverse input order", () => {
  const db = fixture();
  try {
    const z = member("id-z", { x_user_id: "alice", order_index: 1 });
    const a = member("id-a", { x_user_id: "bob", order_index: 0, can_edit: 0 });
    insert(db, z);
    insert(db, a);
    insert(db, member("another-video", { video_id: "v2", name: "Foreign" }));
    const input = [z, a];
    assert.equal(Object.values(guard(db, "v1", input))[0], 1);
    assert.deepEqual(input.map(r => r.id), ["id-z", "id-a"], "must not modify input order");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM video_members").get().n, 3);
  } finally { db.close(); }
});

test("MIG-0650 U03d-2d: hidden CAS detects changed permission, deleted rows or public visibility", () => {
  for (const mutation of [
    { sql: "UPDATE video_members SET can_edit = 0 WHERE id = 'carry'" },
    { sql: "UPDATE video_members SET edit_updated_at = 999 WHERE id = 'carry'" },
    { sql: "UPDATE video_members SET name = 'Changed' WHERE id = 'carry'" },
    { sql: "UPDATE video_members SET is_public_member = 1 WHERE id = 'carry'" },
    { sql: "DELETE FROM video_members WHERE id = 'carry'" },
  ]) {
    const db = fixture();
    try {
      const original = member("carry");
      insert(db, original);
      db.exec(mutation.sql);
      assert.throws(
        () => guard(db, "v1", [original]),
        undefined,
        "the existing malformed-json CASE must abort on snapshot drift: " + mutation.sql,
      );
    } finally { db.close(); }
  }
});

test("MIG-0650 U03d-2d: cleanup deletes only expected IDs in the same video and hidden state", () => {
  const db = fixture();
  try {
    const injected = member("id' OR 1=1 --");
    const other = member("remain-hidden", { x_user_id: "different" });
    const visible = member("remain-public", { is_public_member: 1 });
    const anotherVideo = member("remain-video", { video_id: "v2" });
    for (const row of [injected, other, visible, anotherVideo]) insert(db, row);
    // A selected public or other-video ID is not deleted, even if erroneously supplied.
    const target = [injected, visible, anotherVideo];
    const sql = compile(buildHiddenCarryRowsDeleteSql("v1", target));
    assert.equal(sql.params.length, 2, "both video ID and JSON ID array must be bound");
    assert.equal(clean(db, "v1", target).changes, 1);
    assert.deepEqual(
      db.prepare("SELECT id FROM video_members ORDER BY id").all().map(x => x.id),
      ["remain-hidden", "remain-public", "remain-video"],
    );
  } finally { db.close(); }
});

test("MIG-0650 U03d-2d: empty ID arrays do not touch unrelated hidden members", () => {
  const db = fixture();
  try {
    insert(db, member("unrelated"));
    assert.equal(Object.values(guard(db, "v1", []))[0], 1);
    assert.equal(clean(db, "v1", []).changes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM video_members").get().n, 1);
  } finally { db.close(); }
});

test("MIG-0650 U03d-2d: unmounted provider is the single source for Next hidden CAS", async () => {
  const legacy = await readFile(
    new URL("../src/video/replaceVideoMembers.ts", import.meta.url),
    "utf8",
  );
  const mutations = await readFile(new URL("../src/video/memberWriteMutationBatch.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/hiddenMemberCarrySql"], "./src/video/hiddenMemberCarrySql.ts");
  assert.match(legacy, /from "\.\/memberWriteMutationBatch\.ts"/);
  assert.match(mutations, /from "\.\/hiddenMemberCarrySql\.ts"/);
  assert.doesNotMatch(legacy, /function buildHiddenCarryRowsGuardSql\s*\(/);
  assert.doesNotMatch(legacy, /function buildHiddenCarryRowsDeleteSql\s*\(/);
});

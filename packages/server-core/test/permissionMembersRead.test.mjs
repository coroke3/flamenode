import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { loadPermissionMembersRead } from "../src/video/permissionMembersRead.ts";

const columns = [
  "id", "video_id", "x_user_id", "name", "role", "comment",
  "order_index", "can_edit", "is_public_member",
  "edit_granted_by_auth_user_id", "edit_granted_at", "edit_updated_at",
];

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE video_members (
    id TEXT PRIMARY KEY, video_id TEXT, x_user_id TEXT, name TEXT,
    role TEXT, comment TEXT, order_index INTEGER, can_edit INTEGER,
    is_public_member INTEGER, edit_granted_by_auth_user_id TEXT,
    edit_granted_at INTEGER, edit_updated_at INTEGER
  )`);
  const reads = [];
  const binding = {
    prepare(query) {
      reads.push(query);
      return {
        bind(...params) {
          return {
            async raw() {
              const statement = sqlite.prepare(query);
              statement.setReturnArrays(true);
              try {
                return statement.all(...params).map(row => [...row]);
              } finally {
                statement.setReturnArrays(false);
              }
            },
          };
        },
      };
    },
  };
  const add = sqlite.prepare(
    `INSERT INTO video_members (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  );
  const insert = (id, videoId, xUserId, isPublic = 1, canEdit = 1) =>
    add.run(id, videoId, xUserId, id, null, null, 0, canEdit, isPublic, null, null, null);
  return { sqlite, reads, insert, db: drizzle(binding, { schema }) };
}

test("MIG-0650 shared member read casefolds, sorts public/editor before hidden, and isolates videos", async () => {
  const { sqlite, db, reads, insert } = fixture();
  try {
    insert("h2", "v1", "ALICE", 0, 0);
    insert("h1", "v1", "alice", 0, 1);
    insert("p", "v1", "Alice", 1, 0);
    insert("hiddenOther", "v1", "other", 0, 1);
    insert("foreign", "v2", "alice", 0, 1);
    const result = await loadPermissionMembersRead(db, "v1", ["@ALICE".replace("@", "")]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.existingRows.length, 3);
    assert.deepEqual(result.rowsByXid.get("alice")?.map(row => row.id), ["p", "h1", "h2"]);
    assert.equal(result.currentHiddenEditorCount, 3, "hidden count covers all X identities on the selected video");
    assert.equal(reads.length, 2, "exactly one member query and one count query");
    assert.match(reads[0], /json_each/i);
    assert.doesNotMatch(reads[0], /ALICE/);
  } finally { sqlite.close(); }
});

test("MIG-0650 shared member read treats hostile identifier as bound data", async () => {
  const { sqlite, db, reads, insert } = fixture();
  try {
    insert("p", "v1", "alice");
    const result = await loadPermissionMembersRead(db, "v1", ["alice') OR 1=1 --"]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.existingRows.length, 0);
      assert.equal(result.currentHiddenEditorCount, 0);
    }
    assert.equal(reads.length, 2);
    assert.doesNotMatch(reads[0], /OR 1=1/);
  } finally { sqlite.close(); }
});

test("MIG-0650 shared member read rejects 201 selected rows before count query", async () => {
  const { sqlite, db, reads, insert } = fixture();
  try {
    for (let i = 0; i < 201; i++) insert(`member-${i}`, "v1", "alice");
    const result = await loadPermissionMembersRead(db, "v1", ["ALICE"]);
    assert.deepEqual(result, {
      ok: false,
      message: "同じ X ID の権限行が多すぎるため、安全に更新できません。重複データを整理してください。",
    });
    assert.equal(reads.length, 1, "fail closed without a second read");
  } finally { sqlite.close(); }
});

test("MIG-0650 shared member read with empty target performs no membership match", async () => {
  const { sqlite, db, reads, insert } = fixture();
  try {
    insert("p", "v1", "alice");
    const result = await loadPermissionMembersRead(db, "v1", []);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.existingRows, []);
      assert.equal(result.rowsByXid.size, 0);
      assert.equal(result.currentHiddenEditorCount, 0);
    }
    assert.equal(reads.length, 2, "preserves CURRENT two bounded reads");
  } finally { sqlite.close(); }
});

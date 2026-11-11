import assert from "node:assert/strict";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildPermissionMutationBatch } from "../src/video/permissionMutationBatch.ts";
import { planVideoPermissionChanges } from "../src/video/permissionPlan.ts";

const dialect = new SQLiteSyncDialect();
const member = (id, xid, isPublic, canEdit) => ({
  id, video_id: "v1", x_user_id: xid, name: id, role: null, comment: null,
  order_index: 0, can_edit: canEdit, is_public_member: isPublic,
  edit_granted_by_auth_user_id: null, edit_granted_at: null, edit_updated_at: null,
});
function collector() {
  const queries = [];
  return {
    db: { run: (stmt) => {
      const query = dialect.sqlToQuery(stmt);
      queries.push(query);
      return { query };
    }},
    queries,
  };
}
function makePlan(intents, rows, profiles, count) {
  return planVideoPermissionChanges({
    intents: new Map(intents), rowsByXid: new Map(rows),
    existingProfileIds: new Set(profiles),
    actorId: "actor", videoId: "v1", now: 1700000000,
    notify: true, makeMemberId: () => "new-member",
    currentHiddenEditorCount: count,
  });
}

test("SA-084 D1 mutation plan preserves guard-before-DML order and exact changes assertions", () => {
  const publicRow = member("pub", "alice", 1, 0);
  const hiddenRow = member("hidden", "charlie", 0, 1);
  const plan = makePlan([
    ["alice", { displayName: "Alice", intent: "on" }],
    ["bob", { displayName: "Bob", intent: "on" }],
    ["charlie", { displayName: "Charlie", intent: "off" }],
  ], [
    ["alice", [publicRow]],
    ["charlie", [hiddenRow]],
  ], ["alice", "charlie"], 1);
  const c = collector();
  const out = buildPermissionMutationBatch(c.db, {
    videoId: "v1", xids: ["alice", "bob", "charlie"],
    existingRows: [publicRow, hiddenRow], currentHiddenEditorCount: 1, plan,
  });
  assert.equal(out.statements.length, 6);
  assert.deepEqual(out.expectedChanges, [null, null, 1, 1, 1, 1]);
  assert.equal(c.queries.length, 6, "none of the statements is executed by the builder");
  assert.match(c.queries[0].sql, /SELECT CASE/);
  assert.match(c.queries[0].sql, /video_members/);
  assert.match(c.queries[1].sql, /SELECT CASE/);
  assert.match(c.queries[2].sql, /INSERT INTO x_users/i);
  assert.match(c.queries[3].sql, /UPDATE video_members/i);
  assert.match(c.queries[4].sql, /INSERT INTO video_members/i);
  assert.match(c.queries[5].sql, /DELETE FROM video_members/i);
  assert.equal(c.queries[0].params.includes("v1"), true);
});

test("SA-084 public-only editor grant avoids hidden count guard, bulk insert and deletion", () => {
  const old = member("pub", "alice", 1, 0);
  const plan = makePlan([
    ["alice", { displayName: "Alice", intent: "on" }],
  ], [["alice", [old]]], ["alice"], 100);
  const c = collector();
  const out = buildPermissionMutationBatch(c.db, {
    videoId: "v1", xids: ["alice"], existingRows: [old],
    currentHiddenEditorCount: 100, plan,
  });
  assert.deepEqual(out.expectedChanges, [null, 1]);
  assert.equal(out.statements.length, 2);
  assert.match(c.queries[1].sql, /UPDATE video_members/i);
});

test("SA-084 pure builder never interpolates malicious X ID into SQL text", () => {
  const id = "alice'); DROP TABLE video_members;--";
  const plan = makePlan([
    [id, { displayName: "Alice", intent: "off" }],
  ], [], [id], 0);
  const c = collector();
  buildPermissionMutationBatch(c.db, {
    videoId: "v1", xids: [id], existingRows: [],
    currentHiddenEditorCount: 0, plan,
  });
  assert.equal(c.queries.length, 1);
  assert.equal(c.queries[0].sql.includes("DROP TABLE"), false);
  assert.ok(c.queries[0].params.some(p => typeof p === "string" && p.includes("DROP TABLE")));
});

test("SA-084 no-op permission intent retains only snapshot CAS and schedules no DML", () => {
  const old = member("pub", "alice", 1, 1);
  const plan = makePlan([
    ["alice", { displayName: "Alice", intent: "on" }],
  ], [["alice", [old]]], ["alice"], 0);
  const c = collector();
  const out = buildPermissionMutationBatch(c.db, {
    videoId: "v1", xids: ["alice"], existingRows: [old],
    currentHiddenEditorCount: 0, plan,
  });
  assert.deepEqual(out.expectedChanges, [null]);
  assert.equal(out.statements.length, 1);
  assert.equal(c.queries.length, 1);
  assert.match(c.queries[0].sql, /SELECT CASE/);
  assert.doesNotMatch(c.queries[0].sql, /INSERT INTO|UPDATE video_members|DELETE FROM/i);
});

test("SA-084 new pending X profile requires exact DML row-change assertion", () => {
  const plan = makePlan([
    ["new-x", { displayName: "New", intent: "on" }],
  ], [], [], 0);
  const c = collector();
  const out = buildPermissionMutationBatch(c.db, {
    videoId: "v1", xids: ["new-x"], existingRows: [],
    currentHiddenEditorCount: 0, plan,
  });
  const index = c.queries.findIndex(q => /INSERT INTO x_users/i.test(q.sql));
  assert.ok(index > 0, "profile INSERT must occur after a snapshot guard");
  assert.equal(out.expectedChanges[index], 1, "zero changed rows must fail the enclosing strict transaction");
  assert.equal(c.queries[index].params.includes("new-x"), true);
});

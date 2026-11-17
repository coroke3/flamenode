import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildAdminVideoMemberMetadataPlan } from "../src/video/adminMemberMetadataPlan.ts";

const dialect = new SQLiteSyncDialect();
const target = {
  id: "video-1", collaboration_type: "individual", updated_at: 42,
  visibility_status: "public",
};
function capture() {
  const calls = [];
  const db = {
    update(table) {
      return {
        set(values) {
          return {
            where(condition) {
              const query = dialect.sqlToQuery(condition);
              const statement = { table, values, query };
              calls.push(statement);
              return statement;
            },
          };
        },
      };
    },
  };
  return { db, calls };
}
const args = extra => ({
  target, actorUserId: "admin-1", nextCollaborationType: "collab",
  now: 12345, publicContentChanged: true, ...extra,
});

test("MIG-0650 U03p: complete no-op returns empty D1/strict audit/expected-count plans", () => {
  const { db, calls } = capture();
  const plan = buildAdminVideoMemberMetadataPlan(db, args({publicContentChanged: false}));
  assert.deepEqual(plan, {statements: [], expectedChanges: [], audits: []});
  assert.equal(calls.length, 0);
});

test("MIG-0650 U03p: video metadata update scopes bound WHERE by server-read ID", () => {
  const { db, calls } = capture();
  const plan = buildAdminVideoMemberMetadataPlan(db, args());
  assert.equal(calls.length, 1);
  assert.equal(plan.statements[0], calls[0]);
  assert.deepEqual(calls[0].values, {collaboration_type:"collab", updated_at:12345});
  for (const column of ["id", "collaboration_type", "updated_at", "visibility_status"]) {
    assert.match(calls[0].query.sql, new RegExp('"' + column + '" = \\\?'),
      "metadata CAS must bind the authorized " + column);
  }
  assert.deepEqual(calls[0].query.params, [
    "video-1", "individual", 42, "public",
  ], "same-second concurrent collaboration/status edits must also be detected");
  assert.deepEqual(plan.expectedChanges, [1], "one row must change inside atomic D1 batch");
});

test("MIG-0650 U03p: exact CURRENT strict video audit includes pre/post collaboration snapshot", () => {
  const { db } = capture();
  const plan = buildAdminVideoMemberMetadataPlan(db, args());
  assert.deepEqual(plan.audits, [{
    table_name: "videos", target_id: "video-1", operation: "UPDATE",
    before: {id:"video-1", collaboration_type:"individual", updated_at:42},
    after: {id:"video-1", collaboration_type:"collab", updated_at:12345},
    actor_user_id: "admin-1", context:"admin-video-members",
    reason: "参加者設定から合作区分を同期",
    retention_class:"normal", restore_strategy:"none", strict:true,
  }]);
  assert.deepEqual(target, {
    id:"video-1", collaboration_type:"individual", updated_at:42, visibility_status:"public",
  });
});

test("MIG-0650 U03p: chapter-only change still produces video dirty/audit even if collaboration type unchanged", () => {
  const { db, calls } = capture();
  const plan = buildAdminVideoMemberMetadataPlan(db, args({
    target: {...target, collaboration_type:"collab"},
    nextCollaborationType:"collab",
    publicContentChanged:true,
  }));
  assert.equal(calls.length, 1);
  assert.deepEqual(plan.expectedChanges, [1]);
  assert.deepEqual(plan.audits[0].before.collaboration_type, "collab");
  assert.deepEqual(plan.audits[0].after.collaboration_type, "collab");
});

test("MIG-0650 U03p: Next imports the shared metadata planner, no duplicate local video audit", async () => {
  const next = await readFile(new URL("../../../src/lib/actions/video/adminMembers.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/adminMemberMetadataPlan"], "./src/video/adminMemberMetadataPlan.ts");
  assert.match(next, /buildAdminVideoMemberMetadataPlan\(db, \{/);
  assert.match(next, /appendVideoAtomicWritePlan\(plan, metadataPlan\)/);
  assert.doesNotMatch(next, /reason: "参加者設定から合作区分を同期"/);
});

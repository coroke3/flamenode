import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildAdminVideoMemberMetadataPlan } from "../src/video/adminMemberMetadataPlan.ts";

const dialect = new SQLiteSyncDialect();
const target = {
  id: "video-1", collaboration_type: "individual", updated_at: 42,
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

test("MIG-0650 U03av: video metadata UPDATE requires server-read ID, type and timestamp", () => {
  const { db, calls } = capture();
  const plan = buildAdminVideoMemberMetadataPlan(db, args());
  assert.equal(calls.length, 1);
  assert.equal(plan.statements[0], calls[0]);
  assert.deepEqual(calls[0].values, {collaboration_type:"collab", updated_at:12345});
  assert.match(calls[0].query.sql, /"id" = \?/);
  assert.deepEqual(calls[0].query.params, ["video-1", "individual", 42]);
  assert.match(calls[0].query.sql, /"collaboration_type" = \?/);
  assert.match(calls[0].query.sql, /"updated_at" = \?/);
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
  assert.deepEqual(target, {id:"video-1", collaboration_type:"individual", updated_at:42});
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

test("MIG-0650 U03av: real SQLite stale metadata rejects writes instead of clobbering a newer collaboration edit", () => {
  const { db } = capture();
  const plan = buildAdminVideoMemberMetadataPlan(db, args());
  const { query, values } = plan.statements[0];
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(
      "CREATE TABLE videos (id TEXT PRIMARY KEY, collaboration_type TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    );
    const insert = sqlite.prepare(
      "INSERT INTO videos (id, collaboration_type, updated_at) VALUES ('video-1', ?, ?)"
    );
    const update = sqlite.prepare(
      'UPDATE videos SET collaboration_type = ?, updated_at = ? WHERE ' + query.sql
    );
    const current = () =>
      sqlite.prepare("SELECT collaboration_type, updated_at FROM videos WHERE id = 'video-1'").get();
    const run = () => update.run(
      values.collaboration_type, values.updated_at, ...query.params
    ).changes;

    insert.run("individual", 42);
    assert.equal(run(), 1, "fresh snapshot updates exactly one video in atomic batch");
    assert.deepEqual({ ...current() }, { collaboration_type: "collab", updated_at: 12345 });

    sqlite.exec("DELETE FROM videos");
    insert.run("individual", 43);
    assert.equal(run(), 0, "stale timestamp cannot overwrite the concurrently edited video");
    assert.deepEqual({ ...current() }, { collaboration_type: "individual", updated_at: 43 });

    sqlite.exec("DELETE FROM videos");
    insert.run("collab", 42);
    assert.equal(run(), 0, "stale collaboration type cannot overwrite even if timestamps collide");
    assert.deepEqual({ ...current() }, { collaboration_type: "collab", updated_at: 42 });

    sqlite.exec("DELETE FROM videos");
    assert.equal(run(), 0, "deleted video must not be recreated by a stale mutation");
    assert.deepEqual(plan.expectedChanges, [1], "host's exact changes() assertion rejects all stale cases");
  } finally {
    sqlite.close();
  }
});

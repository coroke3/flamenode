import assert from "node:assert/strict";
import test from "node:test";
import { videos } from "@flamenode/db/schema";
import { buildFreeVideoInsertPlan } from "@flamenode/server-core/video/freeVideoInsertPlan";
import { buildFreeVideoRow } from "@flamenode/server-core/video/freeVideoRow";

const args = {
  videoId: "v:A", eventId: "ev:1", activeX: "x-user", userId: "auth-user",
  data: { display_name: "Artist", title: "Video", is_collab: true, part: " A " },
  iconUrl: null, creatorYoutubeChannelUrl: null, creatorOtherSocialLinks: null,
  youtubeId: "abcdefghijk", scheduledTime: 1770000001, now: 1770000000,
};

test("MIG-0651 U02: videos INSERT is planned once with full 30-column row and strict audit", () => {
  const row = buildFreeVideoRow(args);
  let executions = 0;
  const builder = { table: null, values: null };
  const db = { insert: (table) => {
    builder.table = table;
    return { values: (value) => {
      builder.values = value;
      return { query: "video-insert" };
    } };
  }, batch: () => { executions++; throw new Error("must not execute"); } };
  const plan = buildFreeVideoInsertPlan(db, row, args.userId);
  assert.strictEqual(builder.table, videos);
  assert.strictEqual(builder.values, row);
  assert.deepEqual(plan.statements, [{ query: "video-insert" }]);
  assert.deepEqual(plan.expectedChanges, [1]);
  assert.equal(executions, 0);
  assert.deepEqual(plan.audits, [{
    table_name: "videos",
    target_id: row.id,
    operation: "CREATE",
    before: null,
    after: row,
    actor_user_id: args.userId,
    context: "video-save:create-free",
    retention_class: "normal",
    strict: true,
  }]);
  assert.notStrictEqual(plan.audits[0].after, row);
  assert.equal(Object.keys(plan.audits[0].after).length, 30);
});
test("MIG-0651 U02: snapshot is immutable relative to subsequent row mutations; no shared plan state", () => {
  const row = buildFreeVideoRow(args);
  const db = { insert: () => ({ values: () => ({ query: "insert" }) }) };
  const first = buildFreeVideoInsertPlan(db, row, args.userId);
  const second = buildFreeVideoInsertPlan(db, row, args.userId);
  row.title = "Updated outside transaction";
  assert.equal(first.audits[0].after.title, "Video");
  assert.equal(second.audits[0].after.title, "Video");
  assert.notStrictEqual(first.audits, second.audits);
  assert.notStrictEqual(first.statements, second.statements);
});

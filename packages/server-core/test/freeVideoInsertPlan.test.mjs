import assert from "node:assert/strict";
import test from "node:test";
import { videos, videoYoutubeMetadata } from "@flamenode/db/schema";
import { buildFreeVideoInsertPlan, buildFreeVideoYoutubeMetadataInsertPlan } from "@flamenode/server-core/video/freeVideoInsertPlan";
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

test("MIG-0651 U02: new YouTube pending metadata is one prepared INSERT and strict audit", () => {
  let count = 0;
  const calls = [];
  const db = {
    insert(table) {
      return {
        values(row) {
          count++;
          calls.push({ table, row });
          return { sql: "pending-video-youtube-metadata" };
        },
      };
    },
    batch() { throw new Error("no D1 execution allowed in plan"); },
  };
  const plan = buildFreeVideoYoutubeMetadataInsertPlan(db, {
    videoId: "v:1", actorUserId: "auth-user", now: 1700000000,
  });
  assert.equal(count, 1);
  assert.strictEqual(calls[0].table, videoYoutubeMetadata);
  assert.deepEqual(calls[0].row, {
    video_id: "v:1", youtube_video_id: null,
    youtube_privacy_status: null,
    youtube_availability_status: null,
    duration_seconds: null, view_count: 0,
    synced_at: null, sync_status: "pending",
    sync_error: null, updated_at: 1700000000,
  });
  assert.deepEqual(plan.statements, [{ sql: "pending-video-youtube-metadata" }]);
  assert.deepEqual(plan.expectedChanges, [1]);
  assert.deepEqual(plan.audits, [{
    table_name: "video_youtube_metadata",
    target_id: "v:1",
    operation: "CREATE", before: null,
    after: calls[0].row,
    actor_user_id: "auth-user",
    context: "video-save:youtube-metadata",
    retention_class: "normal",
    strict: true,
  }]);
  assert.notStrictEqual(plan.audits[0].after, calls[0].row);
  for (const input of [
    { videoId: "", actorUserId: "auth-user", now: 1700000000 },
    { videoId: "v:1", actorUserId: "", now: 1700000000 },
    { videoId: "v:1", actorUserId: "auth-user", now: NaN },
    { videoId: "v:1", actorUserId: "auth-user", now: -1 },
  ]) assert.throws(() => buildFreeVideoYoutubeMetadataInsertPlan(db, input), /metadata_plan_invalid/);
  assert.equal(count, 1, "invalid arguments produce no DB statement");
});

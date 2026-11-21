import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { videoCustomAnswers, videoEvents, videoYoutubeMetadata, videos } from "@flamenode/db/schema";
import { buildFreeVideoSubmissionAtomicPlan } from "../src/video/freeVideoSubmissionAtomicPlan.ts";
import { buildFreeVideoRow } from "../src/video/freeVideoRow.ts";

const NOW = 1770000000;
function video(eventId = null) {
  return buildFreeVideoRow({
    videoId: "v:1", eventId, activeX: "alice", userId: "user-1",
    data: { title: "Title", display_name: "Alice", is_collab: false },
    iconUrl: null, creatorYoutubeChannelUrl: null,
    creatorOtherSocialLinks: null, youtubeId: "dQw4w9WgXcQ",
    scheduledTime: NOW, now: NOW,
  });
}
function question(id = "q:1") {
  const source = {
    id, event_id: "event-a", question_key: id, label: "Question",
    type: "text", required: 0, options_json: null, max_length: null,
    sort_order: 0, visibility: "review", updated_at: NOW,
  };
  return {
    id, event_id: source.event_id, question_key: id,
    label: source.label, type: "text", required: false, options: [],
    max_length: null, is_active: true, source,
  };
}
function fixture() {
  const calls = [];
  const db = {
    run(expr) {
      const obj = { action: "assert", expr };
      calls.push(obj);
      return obj;
    },
    insert(table) {
      return { values(value) {
        const obj = { action: "insert", table, value };
        calls.push(obj);
        return obj;
      } };
    },
    batch() { throw Error("never execute a prepared plan"); },
  };
  return { db, calls };
}

test("MIG-0651 atomic composer: null event inserts video and pending YouTube metadata with strict audits", () => {
  const { db, calls } = fixture();
  const row = video();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: row, actorUserId: "user-1", eventId: null,
    questions: [], customAnswerDrafts: [], now: NOW,
  });
  assert.equal(plan.statements.length, 2);
  assert.strictEqual(plan.statements[0].table, videos);
  assert.deepEqual(plan.statements[0].value, row);
  assert.strictEqual(plan.statements[1].table, videoYoutubeMetadata);
  assert.equal(plan.statements[1].value.sync_status, "pending");
  assert.equal(plan.statements[1].value.youtube_video_id, null, "canonical YouTube id lives in videos");
  assert.equal(plan.statements[1].value.view_count, 0);
  assert.equal(plan.statements[1].value.updated_at, NOW);
  assert.deepEqual(plan.expectedChanges, [1, 1]);
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict]),
    [["videos", "CREATE", true], ["video_youtube_metadata", "CREATE", true]]);
  assert.deepEqual(plan.audits[1].after, plan.statements[1].value);
  assert.notStrictEqual(plan.audits[1].after, plan.statements[1].value);
  assert.equal(calls.length, 2, "only required D1 inserts, never executes");
});

test("MIG-0651 atomic composer: event and entire question-set assertions MUST precede every INSERT", () => {
  const { db } = fixture();
  const row = video("event-a");
  const q = question();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: row, actorUserId: "user-1", eventId: "event-a",
    questions: [q], customAnswerDrafts: [{
      event_id: "event-a", question_id: "q:1", question_key: "q:1",
      answer_text: "ok", answer_json: null,
    }], now: NOW,
  });
  assert.deepEqual(plan.statements.map(s => s.action),
    ["assert", "assert", "insert", "insert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 1]);
  assert.deepEqual(plan.statements.slice(2).map(s => s.table),
    [videos, videoYoutubeMetadata, videoEvents, videoCustomAnswers]);
  const statements = plan.statements.slice(0, 2).map(s =>
    new SQLiteSyncDialect().sqlToQuery(s.expr));
  assert.match(statements[0].sql, /events/);
  assert.match(statements[1].sql, /event_custom_questions/);
  assert.ok(statements[0].params.includes("event-a"));
  assert.ok(statements[1].params.includes("event-a"));
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict]), [
    ["videos", "CREATE", true],
    ["video_youtube_metadata", "CREATE", true],
    ["video_events", "CREATE", true],
    ["video_custom_answers", "CREATE", true],
  ]);
  assert.ok(plan.audits.every(a => a.actor_user_id === "user-1"));
});

test("MIG-0651 atomic composer: event selected with zero answers still asserts policy", () => {
  const { db } = fixture();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: video("event-a"), actorUserId: "user-1", eventId: "event-a",
    questions: [question()], customAnswerDrafts: [], now: NOW,
  });
  assert.deepEqual(plan.statements.map(s => s.action),
    ["assert", "assert", "insert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1]);
  assert.equal(plan.audits.length, 3);
});

test("MIG-0651 atomic composer: actor, selected event, clock and stale answer mismatch fail closed", () => {
  const samples = [
    { videoAfter: video(), actorUserId: "other", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", eventId: "event-a", questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", eventId: null, questions: [], customAnswerDrafts: [], now: NOW+1 },
  ];
  for (const sample of samples) {
    const { db, calls } = fixture();
    assert.throws(() => buildFreeVideoSubmissionAtomicPlan(db, sample),
      /identity_invalid/);
    assert.equal(calls.length, 0);
  }
  const { db } = fixture();
  assert.throws(() => buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: video("event-a"), actorUserId: "user-1", eventId: "event-a",
    questions: [question()], customAnswerDrafts: [{
      event_id: "other", question_id: "q:1", question_key: "q:1",
      answer_text: "bad", answer_json: null,
    }], now: NOW,
  }), /video_custom_answer_draft_invalid/);
});

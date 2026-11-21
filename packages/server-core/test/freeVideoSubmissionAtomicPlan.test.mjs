import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { events, videoCustomAnswers, videoEvents, videos } from "@flamenode/db/schema";
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

test("MIG-0651 atomic composer: null event has only video INSERT and its strict audit", () => {
  const { db, calls } = fixture();
  const row = video();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: row, actorUserId: "user-1", eventId: null,
    questions: [], customAnswerDrafts: [], now: NOW,
  });
  assert.equal(plan.statements.length, 1);
  assert.deepEqual(plan.statements, [{ action: "insert", table: videos, value: row }]);
  assert.deepEqual(plan.expectedChanges, [1]);
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict]),
    [["videos", "CREATE", true]]);
  assert.equal(calls.length, 1, "no unrelated D1 queries or writes");
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
    ["assert", "assert", "insert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1]);
  assert.deepEqual(plan.statements.slice(2).map(s => s.table),
    [videos, videoEvents, videoCustomAnswers]);
  const statements = plan.statements.slice(0, 2).map(s =>
    new SQLiteSyncDialect().sqlToQuery(s.expr));
  assert.match(statements[0].sql, /events/);
  assert.match(statements[1].sql, /event_custom_questions/);
  assert.ok(statements[0].params.includes("event-a"));
  assert.ok(statements[1].params.includes("event-a"));
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict]), [
    ["videos", "CREATE", true],
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
    ["assert", "assert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, 1, 1]);
  assert.equal(plan.audits.length, 2);
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

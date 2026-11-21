import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { videoCustomAnswers } from "@flamenode/db/schema";
import { buildFreeVideoCustomAnswerInsertPlan } from "../src/video/freeVideoCustomAnswerInsertPlan.ts";

const draft = (q) => ({
  event_id: "ev-a", question_id: q, question_key: q,
  answer_text: "test", answer_json: null,
});
function fixture() {
  const recorded = { run: [], table: null, inserted: null, execution: 0 };
  const db = {
    run(statement) {
      recorded.run.push(statement);
      return { kind: "assertion", sql: statement };
    },
    insert(table) {
      recorded.table = table;
      return { values(rows) {
        recorded.inserted = rows;
        return { kind: "insert" };
      } };
    },
    batch() {
      recorded.execution++;
      throw new Error("planner must not execute");
    },
  };
  return { db, recorded };
}
const args = { videoId: "v:a/b", eventId: "ev-a", actorUserId: "user-a", now: 1700000000 };

test("MIG-0651 custom-answer plan: no selected event is zero-statement, no writes", () => {
  const { db, recorded } = fixture();
  assert.deepEqual(buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, eventId: null, drafts: [],
  }), { statements: [], expectedChanges: [], audits: [] });
  assert.equal(recorded.run.length, 0);
  assert.equal(recorded.execution, 0);
  assert.throws(() => buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, eventId: null, drafts: [draft("q-1")],
  }), /video_custom_answer_event_missing/);
});

test("MIG-0651 custom-answer plan: validation refuses excessive/duplicated/mismatched drafts", () => {
  const { db, recorded } = fixture();
  const bad = [
    { drafts: Array.from({ length: 5 }, (_, i) => draft("q" + i)), error: /atomic_limit/ },
    { drafts: [draft("q1"), draft("q1")], error: /duplicate_question/ },
    { drafts: [{ ...draft("q1"), event_id: "other" }], error: /draft_invalid/ },
    { drafts: [{ ...draft("q1"), answer_text: "", answer_json: null }], error: /draft_invalid/ },
    { drafts: [{ ...draft("q1"), answer_json: "[]" }], error: /draft_invalid/ },
  ];
  for (const { drafts, error } of bad) {
    assert.throws(() => buildFreeVideoCustomAnswerInsertPlan(db, { ...args, drafts }), error);
  }
  assert.equal(recorded.run.length, 0);
  assert.equal(recorded.inserted, null);
});

test("MIG-0651 custom-answer plan: batch-time question assertion precedes one INSERT and strict per-row audits", () => {
  const { db, recorded } = fixture();
  const plan = buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, drafts: [draft("q:A"), { ...draft("q-B"), answer_text: null, answer_json: '["A"]' }],
  });
  assert.strictEqual(recorded.table, videoCustomAnswers);
  assert.equal(plan.statements.length, 2);
  assert.deepEqual(plan.statements[0], { kind: "assertion", sql: recorded.run[0] });
  assert.deepEqual(plan.statements[1], { kind: "insert" });
  assert.deepEqual(plan.expectedChanges, [null, 2]);
  assert.equal(recorded.execution, 0);
  assert.equal(recorded.inserted.length, 2);
  assert.deepEqual(recorded.inserted[0], {
    video_id: "v:a/b", event_id: "ev-a", question_id: "q:A",
    answer_text: "test", answer_json: null,
    created_at: args.now, updated_at: args.now,
  });
  const query = new SQLiteSyncDialect().sqlToQuery(recorded.run[0]);
  assert.match(query.sql, /SELECT CASE WHEN/i);
  assert.match(query.sql, /event_custom_questions/);
  assert.match(query.sql, /json_extract\('not-valid-json'/);
  assert.ok(query.params.includes("ev-a"));
  assert.ok(query.params.includes("q:A"));
  assert.ok(query.params.includes("q-B"));
  assert.ok(query.params.includes("stage_permission"));
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict, a.target_id]), [
    ["video_custom_answers", "CREATE", true, "v%3Aa%2Fb:ev-a:q%3AA"],
    ["video_custom_answers", "CREATE", true, "v%3Aa%2Fb:ev-a:q-B"],
  ]);
  assert.deepEqual(plan.audits[0].after, recorded.inserted[0]);
  assert.notStrictEqual(plan.audits[0].after, recorded.inserted[0]);
  assert.equal(plan.audits[0].actor_user_id, "user-a");
});

test("MIG-0651 custom-answer plan: empty response for eligible event plans no answer writes", () => {
  const { db, recorded } = fixture();
  assert.deepEqual(buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, drafts: [],
  }), { statements: [], expectedChanges: [], audits: [] });
  assert.equal(recorded.run.length, 0);
});

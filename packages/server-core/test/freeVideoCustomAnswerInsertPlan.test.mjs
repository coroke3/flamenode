import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { videoCustomAnswers } from "@flamenode/db/schema";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { buildFreeVideoCustomAnswerInsertPlan } from "../src/video/freeVideoCustomAnswerInsertPlan.ts";

const args = { videoId: "v:a/b", eventId: "ev-a", actorUserId: "user-a", now: 1700000000 };
const draft = (q) => ({ event_id: "ev-a", question_id: q, question_key: q, answer_text: "test", answer_json: null });
const question = (id, changes = {}) => {
  const row = {
    id, event_id: "ev-a", question_key: id, label: "Question " + id,
    type: "text", required: 0, options_json: null,
    max_length: null, sort_order: 0, visibility: "review",
    updated_at: 1700000000, ...changes,
  };
  return {
    id: row.id, event_id: row.event_id, question_key: row.question_key,
    label: row.label, type: row.type, required: row.required === 1,
    options: row.options_json ? JSON.parse(row.options_json) : [],
    max_length: row.max_length, is_active: true, source: row,
  };
};
function fixture() {
  const recorded = { run: [], table: null, inserted: null, execution: 0 };
  const db = {
    run(statement) { recorded.run.push(statement); return { kind: "assertion", sql: statement }; },
    insert(table) {
      recorded.table = table;
      return { values(rows) { recorded.inserted = rows; return { kind: "insert" }; } };
    },
    batch() { recorded.execution++; throw new Error("planner must not execute"); },
  };
  return { db, recorded };
}
const sorted = (...values) => values.sort((a, b) =>
  a.source.sort_order - b.source.sort_order ||
  a.id.localeCompare(b.id, "en"),
);

test("MIG-0651 custom-answer plan: unaffiliated zero plan, no stale event answers", () => {
  const { db, recorded } = fixture();
  assert.deepEqual(buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, eventId: null, questions: [], drafts: [],
  }), { statements: [], expectedChanges: [], audits: [] });
  assert.throws(() => buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, eventId: null, questions: [], drafts: [draft("q-1")],
  }), /video_custom_answer_event_missing/);
  assert.equal(recorded.execution, 0);
});

test("MIG-0651 custom-answer plan: invalid/duplicate/unrecognized and >4 drafts fail before any D1", () => {
  const { db, recorded } = fixture();
  const qs = sorted(...Array.from({ length: 5 }, (_, i) => question("q" + i)));
  const cases = [
    { drafts: qs.map(q => draft(q.id)), error: /atomic_limit/ },
    { drafts: [draft("q1"), draft("q1")], error: /duplicate_question/ },
    { drafts: [{ ...draft("q1"), event_id: "other" }], error: /draft_invalid/ },
    { drafts: [draft("unknown")], error: /draft_invalid/ },
    { drafts: [{ ...draft("q1"), answer_text: "" }], error: /draft_invalid/ },
    { drafts: [{ ...draft("q1"), answer_json: "[]" }], error: /draft_invalid/ },
  ];
  for (const { drafts, error } of cases) {
    assert.throws(() => buildFreeVideoCustomAnswerInsertPlan(db, {
      ...args, questions: qs, drafts,
    }), error);
  }
  assert.equal(recorded.run.length, 0);
  assert.equal(recorded.inserted, null);
});

test("MIG-0651 custom-answer plan: policy snapshot assertion precedes single INSERT and strict audits", () => {
  const { db, recorded } = fixture();
  const qs = sorted(question("q:A"), question("q-B", {
    type: "checkbox", options_json: '["A"]',
  }));
  const plan = buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, questions: qs,
    drafts: [draft("q:A"), { ...draft("q-B"), answer_text: null, answer_json: '["A"]' }],
  });
  assert.strictEqual(recorded.table, videoCustomAnswers);
  assert.equal(plan.statements.length, 2);
  assert.deepEqual(plan.statements[0], { kind: "assertion", sql: recorded.run[0] });
  assert.deepEqual(plan.statements[1], { kind: "insert" });
  assert.deepEqual(plan.expectedChanges, [null, 2]);
  assert.equal(recorded.execution, 0);
  assert.deepEqual(recorded.inserted[0], {
    video_id: "v:a/b", event_id: "ev-a", question_id: "q:A",
    answer_text: "test", answer_json: null,
    created_at: args.now, updated_at: args.now,
  });
  const query = new SQLiteSyncDialect().sqlToQuery(recorded.run[0]);
  assert.match(query.sql, /json_group_array/);
  assert.match(query.sql, /event_custom_questions/);
  assert.match(query.sql, /json_extract\('not-valid-json'/);
  assert.ok(query.params.includes("ev-a"));
  assert.ok(query.params.some(p => typeof p === "string" && p.includes('"q:A"') && p.includes('"q-B"')));
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict, a.target_id]), [
    ["video_custom_answers", "CREATE", true, "v%3Aa%2Fb:ev-a:q%3AA"],
    ["video_custom_answers", "CREATE", true, "v%3Aa%2Fb:ev-a:q-B"],
  ]);
  assert.deepEqual(plan.audits[0].after, recorded.inserted[0]);
  assert.notStrictEqual(plan.audits[0].after, recorded.inserted[0]);
});

test("MIG-0651 custom-answer plan: a caller cannot bypass required, options, length or checkbox checks", () => {
  const { db, recorded } = fixture();
  const questions = sorted(
    question("required", { required: 1, sort_order: 0 }),
    question("choices", { type: "select", options_json: '["A","B"]', sort_order: 1 }),
    question("details", { max_length: 3, sort_order: 2 }),
    question("multi", { type: "checkbox", options_json: '["X","Y"]', sort_order: 3 }),
  );
  const required = draft("required");
  const cases = [
    { drafts: [], error: /draft_policy_invalid/ },
    { drafts: [{ ...required, answer_text: "  " }], error: /draft_invalid/ },
    { drafts: [required, { ...draft("choices"), answer_text: "nope" }], error: /draft_policy_invalid/ },
    { drafts: [required, { ...draft("details"), answer_text: "too-long" }], error: /draft_policy_invalid/ },
    { drafts: [required, { ...draft("multi"), answer_text: null, answer_json: '["X","Z"]' }], error: /draft_policy_invalid/ },
    { drafts: [required, { ...draft("multi"), answer_text: null, answer_json: '["X","X"]' }], error: /draft_policy_invalid/ },
    { drafts: [required, { ...draft("multi"), answer_text: null, answer_json: '{invalid' }], error: /draft_invalid/ },
    { drafts: [{ ...draft("multi"), answer_text: null, answer_json: '["X"]' }, required], error: /draft_policy_invalid/ },
  ];
  for (const { drafts, error } of cases) {
    assert.throws(
      () => buildFreeVideoCustomAnswerInsertPlan(db, { ...args, questions, drafts }),
      error,
    );
  }
  assert.equal(recorded.inserted, null, "invalid input creates no mutation statement");
});

test("MIG-0651 custom-answer plan: zero submitted answers still asserts unchanged question set", () => {
  const { db, recorded } = fixture();
  const plan = buildFreeVideoCustomAnswerInsertPlan(db, {
    ...args, questions: [], drafts: [],
  });
  assert.equal(recorded.run.length, 1);
  assert.deepEqual(plan.expectedChanges, [null]);
  assert.equal(plan.audits.length, 0);
  assert.equal(plan.statements.length, 1);
  assert.equal(recorded.inserted, null);
});

test("MIG-0651 custom-answer plan: real SQLite fails closed on concurrent question policies", () => {
  const sqlite = createSqlite();
  const { db, recorded } = fixture();
  try {
    insert(sqlite, "events", { id: "ev-a", title: "Event A" });
    insert(sqlite, "events", { id: "ev-b", title: "Event B" });
    const q = question("q-check");
    insert(sqlite, "event_custom_questions", {
      ...q.source, is_active: 1,
    });
    const plan = buildFreeVideoCustomAnswerInsertPlan(db, {
      ...args, questions: [q], drafts: [draft("q-check")],
    });
    assert.equal(plan.statements.length, 2);
    const query = new SQLiteSyncDialect().sqlToQuery(recorded.run[0]);
    const check = () => sqlite.prepare(query.sql).get(...query.params);
    assert.doesNotThrow(check, "unchanged policy must pass");
    const set = (col, value) => {
      sqlite.prepare(`UPDATE event_custom_questions SET ${col}=? WHERE id='q-check'`).run(value);
      assert.throws(check, `policy ${col} drift must abort before INSERT`);
      sqlite.prepare(`UPDATE event_custom_questions SET ${col}=? WHERE id='q-check'`).run(col === "is_active" ? 1 : q.source[col]);
      assert.doesNotThrow(check, `original policy ${col} must pass`);
    };
    set("required", 1);
    set("options_json", '["different"]');
    set("max_length", 10);
    set("type", "textarea");
    set("visibility", "private");
    set("updated_at", args.now + 1);
    set("is_active", 0);
    set("question_key", "renamed");
    set("event_id", "ev-b");
    insert(sqlite, "event_custom_questions", {
      id: "q-new", event_id: "ev-a", question_key: "q-new",
      label: "New Required", required: 1, type: "text", is_active: 1,
    });
    assert.throws(check, "new required question must abort old submission");
    sqlite.prepare("DELETE FROM event_custom_questions WHERE id='q-new'").run();
    assert.doesNotThrow(check, "restoring original set passes");
    sqlite.prepare("DELETE FROM event_custom_questions WHERE id='q-check'").run();
    assert.throws(check, "deleted question must fail");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 0);
    assert.equal(recorded.execution, 0);
  } finally {
    sqlite.close();
  }
});

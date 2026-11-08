import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  MAX_EVENT_CREATE_QUESTIONS,
  MAX_EVENT_CREATE_QUESTIONS_PER_INSERT,
  planEventCreateQuestionBatch,
} from "@flamenode/domain/event";

const rows = (prefix, n) => Array.from({ length: n }, (_, i) => ({
  id: prefix + "_id" + i,
  question_key: prefix + i,
  label: prefix + " " + i,
}));
const plan = ({ template = [], submitted = { present: false }, stage = [] } = {}) =>
  planEventCreateQuestionBatch({
    templateGeneralQuestions: template,
    submittedGeneral: submitted,
    stageQuestions: stage,
  });

test("MIG-0652 U02 questions: absent submitted marker preserves template rows then stage order", () => {
  const template = rows("template", 3);
  const stage = rows("stage_permission_", 2);
  const result = plan({ template, stage });
  assert.equal(result.ok, true);
  assert.deepEqual(result.questions, [...template, ...stage]);
  assert.deepEqual(result.chunks, [[...template, ...stage]]);
  assert.deepEqual(template.map(x => x.question_key), rows("template", 3).map(x => x.question_key));
});

test("MIG-0652 U02 questions: explicit empty form replaces inherited template questions", () => {
  const result = plan({
    template: rows("old", 2),
    submitted: { present: true, planned: { ok: true, rows: [] } },
    stage: rows("stage_permission_", 1),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.questions.map(x => x.question_key), ["stage_permission_0"]);
});

test("MIG-0652 U02 questions: explicit submitted form replaces all template rows, then stage follows", () => {
  const result = plan({
    template: rows("old", 3),
    submitted: { present: true, planned: { ok: true, rows: rows("new", 2) } },
    stage: rows("stage_permission_", 2),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.questions.map(x => x.question_key),
    ["new0", "new1", "stage_permission_0", "stage_permission_1"]);
});

test("MIG-0652 U02 questions: newly submitted general questions obey template-expanded cap", () => {
  const exceedingDefault = plan({
    template: rows("template", 2),
    submitted: { present: true, planned: { ok: true, rows: rows("new", 5) } },
  });
  assert.deepEqual(exceedingDefault, { ok: false, message: "カスタム質問は最大4件です。" });

  const legacyTemplate = rows("template", 6);
  const retained = plan({
    template: legacyTemplate,
    submitted: { present: true, planned: { ok: true, rows: rows("new", 6) } },
  });
  assert.equal(retained.ok, true);
  const exceeded = plan({
    template: legacyTemplate,
    submitted: { present: true, planned: { ok: true, rows: rows("new", 7) } },
  });
  assert.deepEqual(exceeded, { ok: false, message: "カスタム質問は最大6件です。" });
});

test("MIG-0652 U02 questions: source planner validation errors take precedence over all limits", () => {
  const result = plan({
    submitted: { present: true, planned: { ok: false, message: "カスタム質問の識別子が不正です。" } },
    stage: rows("stage_permission_", 5),
  });
  assert.deepEqual(result, { ok: false, message: "カスタム質問の識別子が不正です。" });
});

test("MIG-0652 U02 questions: stage cap precedes total cap and cross-question duplicate detection", () => {
  const result = plan({
    template: rows("general", 17),
    stage: rows("stage_permission_", 5),
  });
  assert.deepEqual(result, { ok: false, message: "ステージ・権利確認質問は最大4件です。" });
});

test("MIG-0652 U02 questions: existing template count can hit combined max 18 but not exceed it", () => {
  assert.equal(MAX_EVENT_CREATE_QUESTIONS, 18);
  const valid = plan({ template: rows("template", 14), stage: rows("stage_permission_", 4) });
  assert.equal(valid.ok, true);
  assert.equal(valid.questions.length, 18);
  const invalid = plan({ template: rows("template", 15), stage: rows("stage_permission_", 4) });
  assert.deepEqual(invalid, {
    ok: false, message: "カスタム質問はステージ質問を含めて最大18件です。",
  });
});

test("MIG-0652 U02 questions: cross-source key collisions abort before D1 chunk planning", () => {
  const a = plan({ template: [{ question_key: "stage_permission_0" }], stage: [{ question_key: "stage_permission_0" }] });
  assert.deepEqual(a, { ok: false, message: "カスタム質問の識別子が重複しています。" });
  const b = plan({
    submitted: { present: true, planned: { ok: true, rows: rows("duplicate", 2) } },
    stage: [{ question_key: "duplicate1" }],
  });
  assert.equal(b.ok, false);
  assert.equal(b.message, "カスタム質問の識別子が重複しています。");
});

test("MIG-0652 U02 questions: six-row D1 chunks keep insertion and audit order", () => {
  assert.equal(MAX_EVENT_CREATE_QUESTIONS_PER_INSERT, 6);
  const input = rows("template", 13);
  const result = plan({ template: input });
  assert.equal(result.ok, true);
  assert.deepEqual(result.chunks.map(c => c.length), [6, 6, 1]);
  assert.deepEqual(result.chunks.flat(), result.questions);
  assert.deepEqual(result.questions, input);
  assert.deepEqual(plan().chunks, []);
});

test("MIG-0652 U02 questions: source limits, ordering and CURRENT route isolation are explicit", async () => {
  const legacy = await readFile(new URL("../../../src/lib/actions/event-admin.ts", import.meta.url), "utf8");
  const core = await readFile(new URL("../src/event/createQuestionPlan.ts", import.meta.url), "utf8");
  assert.match(legacy, /const MAX_EVENT_CUSTOM_QUESTIONS = 18/);
  assert.match(legacy, /const MAX_QUESTIONS_PER_INSERT = 6/);
  assert.match(legacy, /if \(formGeneralPresent\)/);
  assert.match(legacy, /if \(stageQuestions.length > MAX_STAGE_PERMISSION_QUESTIONS\)/);
  assert.match(legacy, /const questions = \[\.\.\.generalQuestions, \.\.\.stageQuestions\]/);
  assert.match(legacy, /if \(new Set\(questions.map\(\(row\) => row.question_key\)\).size !== questions.length\)/);
  assert.match(legacy, /const questionChunks = questionInsertChunks\(questions\)/);
  assert.doesNotMatch(core, /from ["']@\//);
  assert.doesNotMatch(core, /drizzle|D1Database|fetch\(|generateId\(/);
});

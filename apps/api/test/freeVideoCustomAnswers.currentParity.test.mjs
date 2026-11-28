import assert from "node:assert/strict";
import test from "node:test";
import { parseOptionsJson, parseQuestionType, readCustomAnswersFromFormData } from "../../../src/lib/video/customQuestions.ts";
import {
  parseSubmissionQuestionOptionsJson,
  parseSubmissionQuestionType,
  validateSubmissionCustomAnswers,
} from "@flamenode/domain/video";

// This compares the new *pure* Hono candidate against CURRENT's actual
// unmodified input parser, not a fixture made from the candidate's own output.
const eventId = "event-a";
const makeQuestion = (question_key, overrides = {}) => ({
  id: "question-" + question_key,
  event_id: eventId,
  question_key,
  label: "質問:" + question_key,
  description: null,
  type: "text",
  required: false,
  options: [],
  placeholder: null,
  max_length: null,
  sort_order: 0,
  is_active: true,
  visibility: "review",
  ...overrides,
});
const name = (q) => `custom_answer:${eventId}:${q}`;
const makeForm = (pairs = []) => {
  const result = new FormData();
  for (const [key, value] of pairs) result.append(name(key), value);
  return result;
};
function compareWithCurrent(questions, formData) {
  const actual = validateSubmissionCustomAnswers(formData, questions);
  const current = readCustomAnswersFromFormData(
    formData, new Map([[eventId, questions]]),
  );
  if (current.errors.length > 0) {
    assert.deepEqual(actual, { ok: false, message: current.errors[0] });
  } else if (current.drafts.length <= 4) {
    assert.deepEqual(actual, { ok: true, drafts: current.drafts });
  } else {
    assert.deepEqual(actual, {
      ok: false, message: "カスタム質問の回答は最大4件まで保存できます。",
    });
  }
}
test("MIG-0651 CURRENT parity: option normalization and type fallback", () => {
  const options = [
    '[" A ","A",3,"B"]',
    '{"not":"an array"}',
    '[]',
    '["\ud83d"]',
    JSON.stringify(Array.from({ length: 52 }, (_, i) => "option-" + i)),
    null,
  ];
  for (const raw of options) {
    assert.deepEqual(parseSubmissionQuestionOptionsJson(raw), parseOptionsJson(raw));
  }
  for (const type of ["text", "textarea", "select", "radio", "checkbox", "legacy"]) {
    assert.equal(parseSubmissionQuestionType(type), parseQuestionType(type));
  }
});
test("MIG-0651 CURRENT parity: required, inactive, empty and multiple errors", () => {
  const qs = [makeQuestion("first", { required: true }), makeQuestion("later", { required: true })];
  compareWithCurrent(qs, makeForm());
  compareWithCurrent(qs, makeForm([["first", "   "], ["later", "present"]]));
  compareWithCurrent([makeQuestion("hidden", { required: true, is_active: false })], makeForm());
  compareWithCurrent(qs, makeForm([["first", "ok"], ["later", "ok"]]));
});
test("MIG-0651 CURRENT parity: text length, select/radio and checkbox order", () => {
  for (const type of ["text", "textarea", "select", "radio", "checkbox"]) {
    const question = makeQuestion("answer", {
      type, max_length: 3, options: ["A", "B"],
    });
    const cases = [
      makeForm(),
      makeForm([["answer", " A "]]),
      makeForm([["answer", "A"], ["answer", " B "], ["answer", " A "]]),
      makeForm([["answer", "z".repeat(5)]]),
      makeForm([["answer", "invalid"]]),
    ];
    for (const form of cases) compareWithCurrent([question], form);
  }
});
test("MIG-0651 CURRENT parity: malformed file answer ignored and 5-draft cap", () => {
  const file = new Blob(["hello"], { type: "text/plain" });
  compareWithCurrent([makeQuestion("answer", { required: true })],
    makeForm([["answer", file]]));
  const qs = Array.from({ length: 5 }, (_, i) => makeQuestion("q" + i));
  compareWithCurrent(qs, makeForm(qs.map((q) => [q.question_key, "yes"])));
  compareWithCurrent(
    [...qs, makeQuestion("last", { type: "select", options: ["allowed"] })],
    makeForm([...qs.map((q) => [q.question_key, "yes"]), ["last", "invalid"]]),
  );
});

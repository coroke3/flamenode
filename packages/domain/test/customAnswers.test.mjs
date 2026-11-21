import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSubmissionQuestionOptionsJson,
  parseSubmissionQuestionType,
  validateSubmissionCustomAnswers,
} from "../src/video/customAnswers.ts";

const q = (key, extra = {}) => ({
  id: "q-" + key, event_id: "event-a", question_key: key,
  label: key, type: "text", required: false, options: [], max_length: null,
  is_active: true, ...extra,
});
const input = (entries = []) => {
  const form = new FormData();
  for (const [key, value] of entries) form.append("custom_answer:event-a:" + key, value);
  return form;
};

test("MIG-0651 pure custom answers: required, text max and blank behavior match CURRENT", () => {
  assert.deepEqual(validateSubmissionCustomAnswers(input(), [q("name", { required: true })]), {
    ok: false, message: "nameを入力してください。",
  });
  assert.deepEqual(validateSubmissionCustomAnswers(input([["name", "  hi  "]]), [q("name")]), {
    ok: true, drafts: [{
      event_id: "event-a", question_id: "q-name", question_key: "name",
      answer_text: "hi", answer_json: null,
    }],
  });
  assert.deepEqual(validateSubmissionCustomAnswers(input([["name", "abc"]]), [
    q("name", { max_length: 2 }),
  ]), { ok: false, message: "nameは2文字以内で入力してください。" });
  assert.deepEqual(validateSubmissionCustomAnswers(input([["name", "  "]]), [
    q("name", { is_active: false, required: true }),
  ]), { ok: true, drafts: [] });
});

test("MIG-0651 pure custom answers: select/radio restrictions and checkbox order and dedup", () => {
  const opts = ["A", "B"];
  for (const type of ["select", "radio"]) {
    assert.equal(validateSubmissionCustomAnswers(input([["name", "Z"]]), [
      q("name", { type, options: opts }),
    ]).message, "nameは選択肢から選んでください。");
    const good = validateSubmissionCustomAnswers(input([["name", "A"], ["name", "B"]]), [
      q("name", { type, options: opts }),
    ]);
    assert.equal(good.ok, true);
    assert.equal(good.drafts[0].answer_text, "A");
  }
  const answer = validateSubmissionCustomAnswers(input([
    ["name", " B "], ["name", "A"], ["name", " B "],
  ]), [q("name", { type: "checkbox", options: opts })]);
  assert.deepEqual(answer, { ok: true, drafts: [{
    event_id: "event-a", question_id: "q-name", question_key: "name",
    answer_text: null, answer_json: '["B","A"]',
  }] });
  assert.equal(validateSubmissionCustomAnswers(input([["name", "Z"]]), [
    q("name", { type: "checkbox", options: opts }),
  ]).ok, false);
});

test("MIG-0651 pure custom answers: 4-draft atomic limit is fail-closed", () => {
  const qs = Array.from({ length: 5 }, (_, i) => q("a" + i));
  const form = input(qs.map((x) => [x.question_key, "ok"]));
  assert.deepEqual(validateSubmissionCustomAnswers(form, qs), {
    ok: false, message: "カスタム質問の回答は最大4件まで保存できます。",
  });
  assert.equal(validateSubmissionCustomAnswers(form, qs.slice(0, 4)).drafts.length, 4);
});

test("MIG-0651 pure custom answers: options JSON matches CURRENT clipping, dedup and fallback", () => {
  assert.deepEqual(parseSubmissionQuestionOptionsJson('[" A ","A", 7, "B"]'), ["A", "B"]);
  assert.deepEqual(parseSubmissionQuestionOptionsJson("{bad"), []);
  assert.deepEqual(parseSubmissionQuestionOptionsJson('{"a":1}'), []);
  assert.equal(parseSubmissionQuestionOptionsJson(JSON.stringify(
    Array.from({ length: 55 }, (_, i) => "v" + i),
  )).length, 50);
  assert.equal(parseSubmissionQuestionOptionsJson(JSON.stringify(["x".repeat(201)]))[0].length, 200);
  assert.equal(parseSubmissionQuestionType("invalid"), "textarea");
  assert.equal(parseSubmissionQuestionType("checkbox"), "checkbox");
});

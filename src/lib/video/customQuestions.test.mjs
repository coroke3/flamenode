import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCustomAnswerValue,
  parseCustomAnswerValuesJson,
  readCustomAnswersFromFormData,
  validateAnswerInput,
} from "./customQuestions.ts";

function checkboxQuestion(overrides = {}) {
  return {
    id: "question-rights",
    event_id: "event-1",
    question_key: "rights",
    label: "確認済みの権利",
    description: null,
    type: "checkbox",
    required: true,
    options: ["素材", "楽曲", "モデル"],
    placeholder: null,
    max_length: null,
    sort_order: 0,
    is_active: true,
    visibility: "review",
    ...overrides,
  };
}

test("checkbox answer removes duplicates and stores a JSON array", () => {
  const result = validateAnswerInput(
    checkboxQuestion(),
    ["素材", "楽曲", "素材"],
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.drafts, [
    {
      event_id: "event-1",
      question_id: "question-rights",
      question_key: "rights",
      answer_text: null,
      answer_json: JSON.stringify(["素材", "楽曲"]),
    },
  ]);
});

test("checkbox answer rejects values outside configured options", () => {
  const result = validateAnswerInput(
    checkboxQuestion(),
    ["素材", "未定義"],
  );

  assert.deepEqual(result, {
    ok: false,
    message: "確認済みの権利は選択肢から選んでください。",
  });
});

test("required checkbox rejects an empty answer", () => {
  const result = validateAnswerInput(checkboxQuestion(), []);

  assert.deepEqual(result, {
    ok: false,
    message: "確認済みの権利を入力してください。",
  });
});

test("optional empty answer becomes an explicit deletion draft", () => {
  const question = checkboxQuestion({ required: false });
  const formData = new FormData();
  const result = readCustomAnswersFromFormData(
    formData,
    new Map([[question.event_id, [question]]]),
  );

  assert.deepEqual(result, {
    errors: [],
    drafts: [{
      event_id: "event-1",
      question_id: "question-rights",
      question_key: "rights",
      answer_text: null,
      answer_json: null,
    }],
  });
});

test("checkbox JSON is restored to the edit form and review text", () => {
  const json = JSON.stringify({
    "question-rights": ["素材", "モデル"],
  });

  assert.deepEqual(parseCustomAnswerValuesJson(json), {
    "question-rights": ["素材", "モデル"],
  });
  assert.equal(
    formatCustomAnswerValue(null, JSON.stringify(["素材", "モデル"])),
    "素材、モデル",
  );
});

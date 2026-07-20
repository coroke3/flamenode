import assert from "node:assert/strict";
import { test } from "node:test";
import { readCustomQuestionDefinitions } from "./customQuestionForm.ts";
import {
  MAX_CUSTOM_QUESTION_LABEL_LENGTH,
  MAX_CUSTOM_QUESTION_OPTIONS,
  MAX_EVENT_CUSTOM_QUESTIONS,
} from "../video/customQuestionLimits.ts";

function appendQuestion(formData, index, overrides = {}) {
  formData.append("custom_question_key", overrides.key ?? `question_${index}`);
  formData.append("custom_question_active", "1");
  formData.append("custom_question_required", overrides.required ? "1" : "0");
  formData.append("custom_question_label", overrides.label ?? `質問 ${index}`);
  formData.append("custom_question_description", overrides.description ?? "");
  formData.append("custom_question_type", overrides.type ?? "textarea");
  formData.append("custom_question_options", overrides.options ?? "");
  formData.append("custom_question_placeholder", overrides.placeholder ?? "");
  formData.append("custom_question_max_length", overrides.maxLength ?? "1000");
  formData.append("custom_question_visibility", overrides.visibility ?? "review");
}

function questionForm() {
  const formData = new FormData();
  formData.set("custom_questions_present", "1");
  return formData;
}

test("normalized question form reads checkbox options", () => {
  const formData = questionForm();
  appendQuestion(formData, 1, {
    key: "rights",
    label: "確認済みの権利",
    type: "checkbox",
    required: true,
    options: "素材\n楽曲\n素材\nモデル",
    visibility: "private",
  });

  const result = readCustomQuestionDefinitions(formData);
  assert.equal(result.ok, true);
  assert.equal(result.submitted, true);
  assert.deepEqual(result.definitions, [
    {
      question_key: "rights",
      label: "確認済みの権利",
      description: null,
      type: "checkbox",
      required: true,
      options_json: JSON.stringify(["素材", "楽曲", "モデル"]),
      placeholder: null,
      max_length: null,
      sort_order: 0,
      is_active: true,
      visibility: "private",
    },
  ]);
});

test("select, radio and checkbox require options", () => {
  for (const type of ["select", "radio", "checkbox"]) {
    const formData = questionForm();
    appendQuestion(formData, 1, { type, label: `${type}質問` });

    const result = readCustomQuestionDefinitions(formData);
    assert.equal(result.ok, false);
    assert.match(result.message, /1件以上の選択肢/);
  }
});

test("question keys must be unique", () => {
  const formData = questionForm();
  appendQuestion(formData, 1, { key: "duplicate" });
  appendQuestion(formData, 2, { key: "duplicate" });

  const result = readCustomQuestionDefinitions(formData);
  assert.equal(result.ok, false);
  assert.match(result.message, /重複/);
});

test("question count uses the shared limit", () => {
  const formData = questionForm();
  for (let index = 0; index <= MAX_EVENT_CUSTOM_QUESTIONS; index += 1) {
    appendQuestion(formData, index);
  }

  const result = readCustomQuestionDefinitions(formData);
  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`最大${MAX_EVENT_CUSTOM_QUESTIONS}件`));
});

test("invalid question keys are rejected instead of silently normalized", () => {
  const formData = questionForm();
  appendQuestion(formData, 1, { key: "rights question!" });

  const result = readCustomQuestionDefinitions(formData);
  assert.equal(result.ok, false);
  assert.match(result.message, /半角英数字/);
});

test("parallel question fields must stay aligned", () => {
  const formData = questionForm();
  appendQuestion(formData, 1);
  formData.delete("custom_question_visibility");

  const result = readCustomQuestionDefinitions(formData);
  assert.equal(result.ok, false);
  assert.match(result.message, /送信データが不正/);
});

test("overlong question text is rejected instead of truncated", () => {
  const formData = questionForm();
  appendQuestion(formData, 1, {
    label: "a".repeat(MAX_CUSTOM_QUESTION_LABEL_LENGTH + 1),
  });

  const result = readCustomQuestionDefinitions(formData);
  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`${MAX_CUSTOM_QUESTION_LABEL_LENGTH}文字以内`));
});

test("option count over the shared limit is rejected", () => {
  const formData = questionForm();
  appendQuestion(formData, 1, {
    type: "checkbox",
    options: Array.from(
      { length: MAX_CUSTOM_QUESTION_OPTIONS + 1 },
      (_, index) => `option-${index}`,
    ).join("\n"),
  });

  const result = readCustomQuestionDefinitions(formData);
  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`最大${MAX_CUSTOM_QUESTION_OPTIONS}件`));
});

test("invalid type and visibility are rejected", () => {
  const invalidType = questionForm();
  appendQuestion(invalidType, 1, { type: "unknown" });
  const typeResult = readCustomQuestionDefinitions(invalidType);
  assert.equal(typeResult.ok, false);
  assert.match(typeResult.message, /回答形式が不正/);

  const invalidVisibility = questionForm();
  appendQuestion(invalidVisibility, 1, { visibility: "unknown" });
  const visibilityResult = readCustomQuestionDefinitions(invalidVisibility);
  assert.equal(visibilityResult.ok, false);
  assert.match(visibilityResult.message, /公開範囲が不正/);
});

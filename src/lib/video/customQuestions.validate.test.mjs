import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    normalizeOptionList,
    serializeOptionsJson,
    validateAnswerInput,
  } = await import("./customQuestions.ts");

  function question(overrides = {}) {
    return {
      id: "q1",
      event_id: "ev1",
      question_key: "q_color",
      label: "色",
      description: null,
      type: "radio",
      required: false,
      options: ["赤", "青"],
      placeholder: null,
      max_length: null,
      sort_order: 0,
      is_active: true,
      visibility: "review",
      ...overrides,
    };
  }

  test("normalizeOptionList trims, drops empties, and dedupes", () => {
    assert.deepEqual(normalizeOptionList([" 赤 ", "", "赤", "青"]), ["赤", "青"]);
    assert.equal(serializeOptionsJson(["", "  "]), null);
  });

  test("radio/select reject values when options are empty", () => {
    const emptyRadio = question({ options: [] });
    const rejected = validateAnswerInput(emptyRadio, ["自由記述"]);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.match(rejected.message, /選択肢から選んでください/);
    }
  });

  test("radio accepts only listed options", () => {
    const accepted = validateAnswerInput(question(), ["赤"]);
    assert.equal(accepted.ok, true);
    const rejected = validateAnswerInput(question(), ["緑"]);
    assert.equal(rejected.ok, false);
  });

  test("checkbox rejects mixed-in unknown options", () => {
    const rejected = validateAnswerInput(question({ type: "checkbox" }), [
      "赤",
      "緑",
    ]);
    assert.equal(rejected.ok, false);
  });

  test("optional empty choice answers stay empty drafts", () => {
    const result = validateAnswerInput(question({ options: [] }), [""]);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.drafts, []);
  });
}

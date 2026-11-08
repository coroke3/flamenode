import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildVideoFormSettingsJsonCore } from "@flamenode/domain/event";
import { MAX_STAGE_PERMISSION_QUESTIONS } from "@flamenode/domain/event/limits";

const defaults = {
  label: "ステージ・素材・権利まわりの使用許可",
  description: "ステージ、モデル、素材、その他権利確認が必要なものについて記入してください。",
  placeholder: "例：自作ステージ / 利用規約確認済み / 権利者許可済み など",
};
const run = (fields = {}) => {
  const form = new FormData();
  for (const [key, values] of Object.entries(fields)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      form.append(key, value);
    }
  }
  return JSON.parse(buildVideoFormSettingsJsonCore(form, defaults)).stage_permissions;
};

test("MIG-0652 U01: missing or explicit empty stage-question array stays empty", () => {
  assert.deepEqual(run(), []);
  assert.deepEqual(run({ custom_questions_present: "1" }), []);
  assert.deepEqual(run({ custom_questions_present: "true" }), []);
});

test("MIG-0652 U01: original order, ASCII ID cleaning, strict 1 flags and text trimming", () => {
  assert.deepEqual(run({
    custom_question_id: [" First ID! ", "second"],
    custom_question_enabled: ["1", "true"],
    custom_question_required: ["on", "1"],
    custom_question_label: [" 質問1 ", " Q2 "],
    custom_question_description: [" 詳細 ", " description "],
    custom_question_placeholder: [" 入力 ", " placeholder "],
  }), [
    { id: "First_ID_", enabled: true, required: false, label: "質問1",
      description: "詳細", placeholder: "入力" },
    { id: "second", enabled: false, required: true, label: "Q2",
      description: "description", placeholder: "placeholder" },
  ]);
});

test("MIG-0652 U01: index-based fallback IDs and CURRENT Japanese defaults", () => {
  const rows = run({
    custom_question_id: ["  ", "@?!"],
    custom_question_enabled: ["", ""],
    custom_question_label: ["  ", ""],
  });
  assert.equal(rows[0].id, "stage_permission");
  assert.equal(rows[1].id, "___");
  for (const row of rows) {
    assert.equal(row.enabled, false);
    assert.equal(row.required, false);
    assert.equal(row.label, defaults.label);
    assert.equal(row.description, defaults.description);
    assert.equal(row.placeholder, defaults.placeholder);
  }
  assert.equal(run({ custom_question_id: ["a", ""] })[1].id, "stage_permission_2");
});

test("MIG-0652 U01: four-stage cap, trim then UTF-16 truncate, no cross-row dedupe", () => {
  assert.equal(MAX_STAGE_PERMISSION_QUESTIONS, 4);
  const rows = run({
    custom_question_id: ["x".repeat(70), "same", "same", "fourth", "fifth"],
    custom_question_label: [" L ", "a".repeat(121), "third", "fourth", "fifth"],
    custom_question_description: ["d".repeat(1001)],
    custom_question_placeholder: ["p".repeat(501)],
  });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].id, "x".repeat(64));
  assert.equal(rows[0].description.length, 1000);
  assert.equal(rows[0].placeholder.length, 500);
  assert.equal(rows[1].label.length, 120);
  assert.equal(rows[1].id, rows[2].id, "CURRENT does not dedupe stage IDs");
  const cut = "a".repeat(119) + "😀";
  assert.equal(run({custom_question_id:"one",custom_question_label:cut})[0].label, cut.slice(0,120));
});

test("MIG-0652 U01: CURRENT EventForm only delegates to the core with its own defaults", async () => {
  const current = await readFile(new URL("../../../src/lib/event/eventForm.ts", import.meta.url), "utf8");
  const currentDefaults = await readFile(new URL("../../../src/lib/video/formSettings.ts", import.meta.url), "utf8");
  assert.match(current, /import \{ normalizeOptionalEventId, buildVideoFormSettingsJsonCore \} from "@flamenode\/domain\/event"/);
  assert.match(current, /return buildVideoFormSettingsJsonCore\(formData, DEFAULT_STAGE_PERMISSION_FIELD\)/);
  assert.doesNotMatch(current, /function cleanQuestionId\(/);
  for (const value of Object.values(defaults)) {
    assert.ok(currentDefaults.includes(value), "CURRENT fallback source must not drift: " + value);
  }
});

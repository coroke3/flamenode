import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEventTemplateSnapshot,
  snapshotFromEvent,
  snapshotToFormInitial,
} from "./eventTemplateSettings.ts";

function baseEvent(overrides = {}) {
  return {
    schema_version: 3,
    event_type: "event",
    explanation: null,
    icon_url: null,
    img_url: null,
    accent_color: null,
    allow_user_video_event_links: 1,
    allow_unslotted_posts: 0,
    allow_user_video_edits: 1,
    user_video_edit_permission_keys_json: null,
    max_slots_per_video: 1,
    max_consecutive_slots_per_entry: 3,
    slot_part_gap_minutes: 15,
    slot_type: "time",
    slot_visibility_mode: "public_name",
    parts_json: null,
    custom_question_definitions: [],
    review_settings: null,
    editable_fields: null,
    repeat_rules: null,
    ...overrides,
  };
}

function checkboxQuestion(overrides = {}) {
  return {
    question_key: "rights_checked",
    label: "確認済みの権利",
    description: "該当する項目をすべて選択",
    type: "checkbox",
    required: 1,
    options_json: JSON.stringify(["素材", "楽曲", "モデル"]),
    placeholder: null,
    max_length: null,
    sort_order: 0,
    is_active: 1,
    visibility: "review",
    ...overrides,
  };
}

function canonicalTemplateQuestion(overrides = {}) {
  return {
    question_key: "rights_checked",
    label: "確認済みの権利",
    description: "該当する項目をすべて選択",
    type: "checkbox",
    required: true,
    options_json: JSON.stringify(["素材", "楽曲", "モデル"]),
    placeholder: null,
    max_length: null,
    sort_order: 0,
    is_active: true,
    visibility: "review",
    ...overrides,
  };
}

test("snapshotFromEvent stores only active canonical questions in schema v3", () => {
  const snapshot = snapshotFromEvent(baseEvent(), [
    checkboxQuestion(),
    checkboxQuestion({
      question_key: "disabled",
      label: "無効質問",
      is_active: 0,
    }),
  ]);

  assert.equal(snapshot.schema_version, 3);
  assert.equal("video_form_settings_json" in snapshot, false);
  assert.deepEqual(snapshot.custom_question_definitions, [
    canonicalTemplateQuestion(),
  ]);
});

test("schema v3 round trip restores checkbox options to the event form", () => {
  const snapshot = snapshotFromEvent(baseEvent(), [checkboxQuestion()]);
  const parsed = parseEventTemplateSnapshot(JSON.stringify(snapshot));

  assert.ok(parsed);
  const initial = snapshotToFormInitial(parsed);
  assert.equal(initial.custom_questions.length, 1);
  assert.equal(initial.custom_questions[0].type, "checkbox");
  assert.deepEqual(initial.custom_questions[0].options, ["素材", "楽曲", "モデル"]);
  assert.equal(initial.custom_questions[0].required, true);
});

test("old template schemas are rejected without conversion", () => {
  for (const schemaVersion of [1, 2]) {
    const snapshot = parseEventTemplateSnapshot(JSON.stringify({
      ...baseEvent(),
      schema_version: schemaVersion,
    }));
    assert.equal(snapshot, null);
  }
});

test("missing question definitions are rejected instead of defaulting to empty", () => {
  const { custom_question_definitions: _questions, ...withoutQuestions } = baseEvent();
  assert.equal(parseEventTemplateSnapshot(JSON.stringify(withoutQuestions)), null);
});

test("legacy option arrays and coercible booleans are rejected", () => {
  const legacyOptions = {
    ...canonicalTemplateQuestion(),
    options: ["素材", "楽曲"],
  };
  delete legacyOptions.options_json;
  assert.equal(parseEventTemplateSnapshot(JSON.stringify({
    ...baseEvent(),
    custom_question_definitions: [legacyOptions],
  })), null);

  assert.equal(parseEventTemplateSnapshot(JSON.stringify({
    ...baseEvent(),
    custom_question_definitions: [canonicalTemplateQuestion({ required: 1 })],
  })), null);
});

test("template question order must match the array order", () => {
  assert.equal(parseEventTemplateSnapshot(JSON.stringify({
    ...baseEvent(),
    custom_question_definitions: [canonicalTemplateQuestion({ sort_order: 4 })],
  })), null);
});

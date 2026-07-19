import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEventTemplateSnapshot,
  snapshotFromEvent,
  snapshotToFormInitial,
} from "./eventTemplateSettings.ts";

function baseEvent(overrides = {}) {
  return {
    event_type: "event",
    explanation: null,
    icon_url: null,
    img_url: null,
    accent_color: null,
    allow_user_video_event_links: 1,
    allow_unslotted_posts: 0,
    allow_user_video_edits: 1,
    user_video_edit_permission_keys_json: null,
    video_form_settings_json: null,
    max_slots_per_video: 1,
    max_consecutive_slots_per_entry: 3,
    slot_part_gap_minutes: 15,
    slot_type: "time",
    slot_visibility_mode: "public_name",
    parts_json: null,
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

test("snapshotFromEvent stores active normalized questions once", () => {
  const snapshot = snapshotFromEvent(baseEvent({
    video_form_settings_json: JSON.stringify({
      stage_permissions: [{ id: "legacy", enabled: true }],
    }),
  }), [
    checkboxQuestion(),
    checkboxQuestion({
      question_key: "disabled",
      label: "無効質問",
      is_active: 0,
    }),
  ]);

  assert.equal(snapshot.schema_version, 2);
  assert.equal("video_form_settings_json" in snapshot, false);
  assert.deepEqual(snapshot.custom_question_definitions, [
    {
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
    },
  ]);
});

test("template round trip restores checkbox options to the event form", () => {
  const snapshot = snapshotFromEvent(baseEvent(), [checkboxQuestion()]);
  const parsed = parseEventTemplateSnapshot(JSON.stringify(snapshot));

  assert.ok(parsed);
  const initial = snapshotToFormInitial(parsed);
  assert.equal(initial.custom_questions.length, 1);
  assert.equal(initial.custom_questions[0].type, "checkbox");
  assert.deepEqual(initial.custom_questions[0].options, ["素材", "楽曲", "モデル"]);
  assert.equal(initial.custom_questions[0].required, true);
});

test("legacy stage permission JSON is converted only while reading old templates", () => {
  const snapshot = parseEventTemplateSnapshot(JSON.stringify({
    ...baseEvent(),
    video_form_settings_json: JSON.stringify({
      stage_permissions: [
        {
          id: "stage_permission",
          enabled: true,
          required: true,
          label: "権利確認",
          description: "確認内容を入力",
          placeholder: "確認済み",
        },
      ],
    }),
  }));

  assert.ok(snapshot);
  assert.equal(snapshot.schema_version, 2);
  assert.deepEqual(snapshot.custom_question_definitions, [
    {
      question_key: "stage_permission",
      label: "権利確認",
      description: "確認内容を入力",
      type: "textarea",
      required: true,
      options_json: null,
      placeholder: "確認済み",
      max_length: 1000,
      sort_order: 0,
      is_active: true,
      visibility: "review",
    },
  ]);
});

test("parseEventTemplateSnapshot normalizes an absent question definition list", () => {
  const snapshot = parseEventTemplateSnapshot(JSON.stringify(baseEvent()));

  assert.ok(snapshot);
  assert.deepEqual(snapshot.custom_question_definitions, []);
});

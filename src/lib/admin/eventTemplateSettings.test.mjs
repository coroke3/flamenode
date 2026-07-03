import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEventTemplateSnapshot,
  snapshotFromEvent,
} from "./eventTemplateSettings.ts";

function baseEvent(overrides = {}) {
  return {
    event_type: "event",
    explanation: null,
    icon_url: null,
    img_url: null,
    accent_color: null,
    allow_user_video_event_links: 1,
    allow_user_video_edits: 1,
    user_video_edit_permission_keys_json: null,
    video_form_settings_json: null,
    max_slots_per_video: 1,
    max_consecutive_slots_per_entry: 3,
    slot_part_gap_minutes: 15,
    slot_type: "time",
    slot_visibility_mode: "public_name",
    parts_json: null,
    custom_questions: "{\"legacy\":true}",
    review_settings: null,
    editable_fields: null,
    repeat_rules: null,
    ...overrides,
  };
}

test("snapshotFromEvent stores normalized custom questions instead of legacy JSON", () => {
  const snapshot = snapshotFromEvent(baseEvent(), [
    {
      question_key: "extra_note",
      label: "Extra note",
      description: null,
      type: "text",
      required: 1,
      options_json: null,
      placeholder: "Write here",
      max_length: 200,
      sort_order: 2,
      is_active: 0,
      visibility: "private",
    },
  ]);

  assert.equal("custom_questions" in snapshot, false);
  assert.deepEqual(snapshot.custom_question_definitions, [
    {
      question_key: "extra_note",
      label: "Extra note",
      description: null,
      type: "text",
      required: true,
      options_json: null,
      placeholder: "Write here",
      max_length: 200,
      sort_order: 2,
      is_active: false,
      visibility: "private",
    },
  ]);
});

test("parseEventTemplateSnapshot ignores legacy custom_questions payload", () => {
  const snapshot = parseEventTemplateSnapshot(JSON.stringify(baseEvent()));

  assert.ok(snapshot);
  assert.equal("custom_questions" in snapshot, false);
  assert.deepEqual(snapshot.custom_question_definitions, []);
});

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

test("parseEventTemplateSnapshot normalizes an absent question definition list", () => {
  const snapshot = parseEventTemplateSnapshot(JSON.stringify(baseEvent()));

  assert.ok(snapshot);
  assert.deepEqual(snapshot.custom_question_definitions, []);
});

test("parseEventTemplateSnapshot rejects malformed description templates", () => {
  const snapshot = parseEventTemplateSnapshot(
    JSON.stringify(
      baseEvent({
        youtube_description_template: 12345,
      }),
    ),
  );

  assert.ok(snapshot);
  assert.equal(snapshot.youtube_description_template, null);
});

test("parseEventTemplateSnapshot rejects oversized description templates", () => {
  const snapshot = parseEventTemplateSnapshot(
    JSON.stringify(
      baseEvent({
        youtube_description_template: "x".repeat(10_001),
      }),
    ),
  );

  assert.ok(snapshot);
  assert.equal(snapshot.youtube_description_template, null);
});

test("parseEventTemplateSnapshot rejects invalid enum values", () => {
  for (const overrides of [
    { event_type: "unknown" },
    { slot_type: "unknown" },
    { slot_visibility_mode: "unknown" },
  ]) {
    assert.equal(
      parseEventTemplateSnapshot(JSON.stringify(baseEvent(overrides))),
      null,
    );
  }
});

test("parseEventTemplateSnapshot does not leak malformed scalar values", () => {
  const snapshot = parseEventTemplateSnapshot(
    JSON.stringify(
      baseEvent({
        explanation: { unexpected: true },
        icon_url: { unexpected: true },
        allow_user_video_edits: "not-a-number",
        max_slots_per_video: Number.NaN,
        parts_json: ["not", "a", "string"],
      }),
    ),
  );

  assert.ok(snapshot);
  assert.equal(snapshot.explanation, null);
  assert.equal(snapshot.icon_url, null);
  assert.equal(snapshot.allow_user_video_edits, 0);
  assert.equal(snapshot.max_slots_per_video, 1);
  assert.equal(snapshot.parts_json, null);
});

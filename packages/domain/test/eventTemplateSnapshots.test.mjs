import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTemplateQuestionDefinitions,
  parseEventTemplateSnapshot,
  snapshotFromEvent,
  snapshotToFormInitial,
} from "@flamenode/domain/eventTemplates";

const event = {
  event_type: "collabo",
  explanation: "Event information",
  youtube_description_template: "  {{event_title}}\r\nnext  ",
  required_video_fields_json: null,
  icon_url: "https://example.test/icon.png",
  img_url: null,
  accent_color: "#aabbcc",
  allow_user_video_event_links: 1,
  allow_unslotted_posts: 0,
  allow_user_video_edits: 1,
  user_video_edit_permission_keys_json: null,
  max_slots_per_video: 2,
  max_slot_reservation_groups_per_xid: null,
  slot_interval_minutes: null,
  slot_part_gap_minutes: null,
  slot_type: null,
  slot_visibility_mode: null,
  parts_json: null,
  review_settings: null,
  editable_fields: null,
  repeat_rules: null,
};

const questions = [{
  question_key: "q_1",
  label: "Question",
  description: "Description",
  type: "select",
  required: 1,
  options_json: '[" A ","B","A"]',
  placeholder: null,
  max_length: null,
  sort_order: 1,
  is_active: 1,
  visibility: "public",
}];

test("event snapshot retains CURRENT serialized fields and defaults", () => {
  const snapshot = snapshotFromEvent(event, questions, '{"stage_permissions":[]}');
  assert.deepEqual(snapshot.custom_question_definitions, [{
    ...questions[0],
    type: "select",
    required: true,
    is_active: true,
    visibility: "public",
  }]);
  assert.equal(snapshot.video_form_settings_json, '{"stage_permissions":[]}');
  assert.equal(snapshot.slot_type, "time");
  assert.equal(snapshot.slot_visibility_mode, "public_name");
  assert.equal(snapshot.slot_part_gap_minutes, 15);
  assert.equal(snapshot.max_slot_reservation_groups_per_xid, 0);
  assert.equal(snapshot.youtube_description_template, event.youtube_description_template);
});

test("snapshot parser keeps legacy defaults, normalizes questions and clamps counts", () => {
  const snapshot = snapshotFromEvent(event, questions);
  const parsed = parseEventTemplateSnapshot(JSON.stringify({
    ...snapshot,
    youtube_description_template: " \r\nhello\rworld ",
    max_slot_reservation_groups_per_xid: 120,
    slot_interval_minutes: 5000,
    custom_question_definitions: [
      { question_key: " q 1 ", label: " Question ", type: "invalid", visibility: "invalid" },
      { question_key: "q_1", label: "duplicate" },
      { question_key: "", label: "invalid" },
    ],
  }));
  assert.ok(parsed);
  assert.equal(parsed.youtube_description_template, "hello\nworld");
  assert.equal(parsed.max_slot_reservation_groups_per_xid, 100);
  assert.equal(parsed.slot_interval_minutes, null);
  assert.equal(parsed.custom_question_definitions.length, 1);
  assert.equal(parsed.custom_question_definitions[0].question_key, "q_1");
  assert.equal(parsed.custom_question_definitions[0].type, "textarea");
  assert.equal(parsed.custom_question_definitions[0].visibility, "review");
});

test("invalid snapshot never leaks unsupported types or malformed JSON", () => {
  assert.equal(parseEventTemplateSnapshot("{"), null);
  assert.equal(parseEventTemplateSnapshot("[]"), null);
  assert.equal(parseEventTemplateSnapshot('{"event_type":"unknown","slot_type":"time"}'), null);
  assert.equal(parseEventTemplateSnapshot('{"event_type":"event","slot_type":"invalid"}'), null);
  assert.deepEqual(normalizeTemplateQuestionDefinitions(null), []);
});

test("create form resets times, forces private, and omits stage permission questions", () => {
  const snapshot = snapshotFromEvent(event, questions);
  snapshot.custom_question_definitions.push({
    ...snapshot.custom_question_definitions[0],
    question_key: "stage_permission_2",
  });
  const initial = snapshotToFormInitial(snapshot);
  assert.equal(initial.visibility_status, "private");
  for (const key of ["start_time", "end_time", "entry_start_time", "entry_end_time"]) {
    assert.equal(initial[key], null);
  }
  assert.equal(initial.custom_questions.length, 1);
  assert.deepEqual(initial.custom_questions[0].options, ["A", "B"]);
  assert.equal(initial.custom_questions[0].clientId, "q_1");
});

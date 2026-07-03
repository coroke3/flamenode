import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_SECTION_PERMISSION_KEYS,
  snapshotEventSection,
} from "./eventSectionFields.ts";

test("EVENT_SECTION_PERMISSION_KEYS maps sections to permission keys", () => {
  assert.equal(EVENT_SECTION_PERMISSION_KEYS.basic, "event.basic");
  assert.equal(EVENT_SECTION_PERMISSION_KEYS.publish, "event.publish");
  assert.equal(EVENT_SECTION_PERMISSION_KEYS.questions, "event.questions");
  assert.equal(EVENT_SECTION_PERMISSION_KEYS.slots, "event.slots");
});

test("basic section snapshot excludes publish/questions/slots fields", () => {
  const basic = snapshotEventSection("basic", {
    title: "Test",
    event_type: "event",
    explanation: "desc",
    icon_url: null,
    img_url: null,
    accent_color: "#fff",
    start_time: 1,
    end_time: 2,
    visibility_status: "public",
    is_active: 1,
    is_archived: 0,
    entry_start_time: 3,
    entry_end_time: 4,
    allow_user_video_event_links: 1,
    allow_user_video_edits: 1,
    user_video_edit_permission_keys_json: "[]",
    video_form_settings_json: "{}",
    editable_fields: "{}",
    review_settings: "{}",
    slot_type: "time",
    max_slots_per_video: 2,
    max_consecutive_slots_per_entry: 3,
    slot_part_gap_minutes: 15,
    slot_visibility_mode: "public_name",
    parts_json: "[]",
  });
  assert.deepEqual(Object.keys(basic).sort(), [
    "accent_color",
    "end_time",
    "event_type",
    "explanation",
    "icon_url",
    "img_url",
    "start_time",
    "title",
  ]);
});

test("publish section snapshot includes visibility and entry fields only", () => {
  const publish = snapshotEventSection("publish", {
    title: "ignored",
    event_type: "event",
    explanation: null,
    icon_url: null,
    img_url: null,
    accent_color: null,
    start_time: null,
    end_time: null,
    visibility_status: "private",
    is_active: 0,
    is_archived: 0,
    entry_start_time: 10,
    entry_end_time: 20,
    allow_user_video_event_links: 0,
    allow_user_video_edits: 0,
    user_video_edit_permission_keys_json: null,
    video_form_settings_json: null,
    editable_fields: null,
    review_settings: null,
    slot_type: "time",
    max_slots_per_video: 1,
    max_consecutive_slots_per_entry: 1,
    slot_part_gap_minutes: 15,
    slot_visibility_mode: "public_name",
    parts_json: null,
  });
  assert.equal(publish.visibility_status, "private");
  assert.equal(publish.entry_start_time, 10);
  assert.equal(!("title" in publish), true);
});

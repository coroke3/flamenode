import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildEventCreateFields } from "@flamenode/domain/event";
import { serializeRequiredVideoFieldsFromForm } from "@flamenode/domain/video";

const data = (changes = {}) => ({
  title: "Event A",
  event_type: "collabo",
  explanation: "Description",
  youtube_description_template: "About this event",
  icon_url: "https://example.test/icon.png",
  img_url: "https://example.test/header.png",
  accent_color: "#abc",
  visibility_status: "public",
  start_time: "2026-11-08T10:00",
  end_time: "2026-11-08T14:30",
  entry_start_time: "2026-11-01T00:00",
  entry_end_time: "2026-11-08T09:00",
  allow_user_video_event_links: 1,
  allow_unslotted_posts: 0,
  allow_user_video_edits: 1,
  user_video_edit_permission_keys_json: '["video.edit"]',
  max_slots_per_video: 4,
  max_slot_reservation_groups_per_xid: 2,
  slot_interval_minutes: 30,
  slot_part_gap_minutes: 15,
  slot_type: "time",
  slot_visibility_mode: "public_name",
  parts_text: "Opening\nClosing",
  editable_fields: '["user-form-ignored"]',
  review_settings: '{"user-form-ignored":true}',
  ...changes,
});
const template = (changes = {}) => ({
  required_video_fields_json: '["icon_url"]',
  review_settings: '{"auto_approve":false}',
  editable_fields: '["title"]',
  repeat_rules: '{"recurs":true}',
  ...changes,
});
const build = (changes = {}) => buildEventCreateFields({
  id: "ev_a",
  data: data(),
  visibilityStatus: "public",
  requiredVideoFieldsJson: undefined,
  templateSnapshot: null,
  now: 1794115200,
  ...changes,
});

test("MIG-0652 U02: create row projects every CURRENT event column with JST epochs and null template defaults", () => {
  assert.deepEqual(build(), {
    id: "ev_a", title: "Event A", event_type: "collabo",
    explanation: "Description", youtube_description_template: "About this event",
    required_video_fields_json: null,
    icon_url: "https://example.test/icon.png",
    img_url: "https://example.test/header.png", accent_color: "#abc",
    visibility_status: "public", allow_user_video_event_links: 1,
    allow_unslotted_posts: 0, allow_user_video_edits: 1,
    user_video_edit_permission_keys_json: '["video.edit"]',
    start_time: Date.parse("2026-11-08T01:00:00Z") / 1000,
    end_time: Date.parse("2026-11-08T05:30:00Z") / 1000,
    entry_start_time: Date.parse("2026-10-31T15:00:00Z") / 1000,
    entry_end_time: Date.parse("2026-11-08T00:00:00Z") / 1000,
    max_slots_per_video: 4, max_slot_reservation_groups_per_xid: 2,
    slot_interval_minutes: 30, slot_part_gap_minutes: 15,
    slot_type: "time", slot_visibility_mode: "public_name",
    parts_json: '["Opening","Closing"]',
    review_settings: null, editable_fields: null, repeat_rules: null,
    public_api_enabled: 0, created_at: 1794115200, updated_at: 1794115200,
  });
});

test("MIG-0652 U02: absent required-field widget inherits template while template-only policies override form fields", () => {
  const result = build({
    templateSnapshot: template(),
    data: data({ editable_fields: "form-forged", review_settings: "form-forged" }),
    requiredVideoFieldsJson: undefined,
  });
  assert.equal(result.required_video_fields_json, '["icon_url"]');
  assert.equal(result.review_settings, '{"auto_approve":false}');
  assert.equal(result.editable_fields, '["title"]');
  assert.equal(result.repeat_rules, '{"recurs":true}');
  assert.equal(result.title, "Event A", "template must not override submitted title");
});

test("MIG-0652 U02: explicit null required-field selection clears template, while JSON selection replaces it", () => {
  assert.equal(build({ templateSnapshot: template(), requiredVideoFieldsJson: null })
    .required_video_fields_json, null);
  assert.equal(build({ templateSnapshot: template(), requiredVideoFieldsJson: '["cover"]' })
    .required_video_fields_json, '["cover"]');
  const marker = new FormData();
  assert.equal(serializeRequiredVideoFieldsFromForm(marker), undefined);
  assert.equal(build({ templateSnapshot: template(), requiredVideoFieldsJson: serializeRequiredVideoFieldsFromForm(marker) })
    .required_video_fields_json, '["icon_url"]');
  marker.set("required_video_fields_present", "1");
  marker.set("required_video_fields_json", "[]");
  assert.equal(serializeRequiredVideoFieldsFromForm(marker), null);
  assert.equal(build({ templateSnapshot: template(), requiredVideoFieldsJson: serializeRequiredVideoFieldsFromForm(marker) })
    .required_video_fields_json, null);
});

test("MIG-0652 U02: invalid and empty dates, null flags, and blank parts keep CURRENT create defaults", () => {
  const result = build({
    visibilityStatus: "private",
    data: data({
      explanation: null, youtube_description_template: null,
      icon_url: null, img_url: null, accent_color: null,
      start_time: "2026-02-30T01:00", end_time: "",
      entry_start_time: "no date", entry_end_time: null,
      user_video_edit_permission_keys_json: undefined,
      slot_interval_minutes: undefined, parts_text: "\n  \r\n",
    }),
  });
  assert.equal(result.visibility_status, "private");
  assert.equal(result.start_time, null);
  assert.equal(result.end_time, null);
  assert.equal(result.entry_start_time, null);
  assert.equal(result.entry_end_time, null);
  assert.equal(result.user_video_edit_permission_keys_json, null);
  assert.equal(result.slot_interval_minutes, null);
  assert.equal(result.parts_json, null);
  assert.equal(result.explanation, null);
  assert.equal(result.youtube_description_template, null);
});

test("MIG-0652 U02: canonical parts cap and truncation preserve CURRENT semantics without duplicate parser", () => {
  const names = Array.from({ length: 23 }, (_, i) => "Session" + i);
  const result = build({ data: data({ parts_text: names.join("\r\n") }) });
  assert.deepEqual(JSON.parse(result.parts_json), names.slice(0, 20));
  assert.equal(build({ data: data({ parts_text: " A \nA" }) }).parts_json, '["A"]');
});

test("MIG-0652 U02: staged core is DB-independent; CURRENT create route stays unchanged pending handler parity", async () => {
  const core = await readFile(new URL("../src/event/createFields.ts", import.meta.url), "utf8");
  const current = await readFile(new URL("../../../src/lib/actions/event-admin.ts", import.meta.url), "utf8");
  assert.doesNotMatch(core, /from ["']@\//);
  assert.doesNotMatch(core, /drizzle|D1Database|SqliteDatabase/);
  assert.match(current, /export async function createEvent\(/);
  assert.match(current, /const createdRow = \{/);
  assert.match(current, /return fromForm !== undefined\s*\?\s*fromForm\s*:\s*templateSnapshot\?\.required_video_fields_json \?\? null/);
});

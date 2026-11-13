import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildQuestionsEventUpdateFields } from "@flamenode/domain/event";
import { serializeRequiredVideoFieldsFromForm } from "@flamenode/domain/video";

const data = (overrides = {}) => ({
  allow_user_video_edits: 1,
  user_video_edit_permission_keys_json: '["edit_metadata"]',
  editable_fields: '["title"]',
  review_settings: '{"review":true}',
  ...overrides,
});

const build = ({
  fields = data(),
  provided = undefined,
  previousRequired = '["title"]',
  previousEditable = '["description"]',
  previousReview = '{"review":false}',
} = {}) => buildQuestionsEventUpdateFields({
  data: fields,
  requiredVideoFieldsJson: provided,
  previousRequiredVideoFieldsJson: previousRequired,
  previousEditableFields: previousEditable,
  previousReviewSettings: previousReview,
});

test("MIG-0652 U01: absent required-fields input preserves CURRENT stored JSON", () => {
  assert.deepEqual(build(), {
    allow_user_video_edits: 1,
    user_video_edit_permission_keys_json: '["edit_metadata"]',
    required_video_fields_json: '["title"]',
    editable_fields: '["title"]',
    review_settings: '{"review":true}',
  });
});

test("MIG-0652 U01: explicit empty required-fields JSON replaces instead of preserving old", () => {
  for (const next of ["", "[]", '["cover"]']) {
    assert.equal(build({ provided: next }).required_video_fields_json, next);
  }
  assert.equal(build({ provided: undefined, previousRequired: null }).required_video_fields_json, null);
});

test("MIG-0652 U01: nullable serializer explicitly clears prior required video fields", () => {
  const result = build({provided: null, previousRequired: '["title"]'});
  assert.equal(result.required_video_fields_json, null);
  // Only undefined means the form did not submit this field.
  assert.equal(build({provided: undefined, previousRequired: '["title"]'}).required_video_fields_json, '["title"]');
});

test("MIG-0652 U01: real CURRENT form serializer preserves omissions and clears explicit empty selections", () => {
  const absent = new FormData();
  assert.equal(serializeRequiredVideoFieldsFromForm(absent), undefined);
  assert.equal(build({provided: serializeRequiredVideoFieldsFromForm(absent)}).required_video_fields_json, '["title"]');

  const explicitClear = new FormData();
  explicitClear.set("required_video_fields_present", "1");
  explicitClear.set("required_video_fields_json", "[]");
  assert.equal(serializeRequiredVideoFieldsFromForm(explicitClear), null);
  assert.equal(build({provided: serializeRequiredVideoFieldsFromForm(explicitClear)}).required_video_fields_json, null);

  const ignored = new FormData();
  ignored.set("required_video_fields_present", "true");
  ignored.set("required_video_fields_json", "[]");
  assert.equal(serializeRequiredVideoFieldsFromForm(ignored), undefined);
  assert.equal(build({provided: serializeRequiredVideoFieldsFromForm(ignored)}).required_video_fields_json, '["title"]');
});

test("MIG-0652 U01: optional editor and review settings retain old values on null/undefined", () => {
  const result = build({ fields: data({
    user_video_edit_permission_keys_json: null,
    editable_fields: null,
    review_settings: undefined,
  }) });
  assert.equal(result.user_video_edit_permission_keys_json, null);
  assert.equal(result.editable_fields, '["description"]');
  assert.equal(result.review_settings, '{"review":false}');
});

test("MIG-0652 U01: explicit empty editor/review strings do not get replaced by old value", () => {
  const result = build({ fields: data({ editable_fields: "", review_settings: "" }) });
  assert.equal(result.editable_fields, "");
  assert.equal(result.review_settings, "");
  assert.equal(build({ fields: data({ user_video_edit_permission_keys_json: "" }) }).user_video_edit_permission_keys_json, "");
});

test("MIG-0652 U01: CURRENT numeric edit flags and previous nulls are preserved", () => {
  for (const flag of [0, 1]) {
    const fields = build({
      fields: data({
        allow_user_video_edits: flag,
        user_video_edit_permission_keys_json: undefined,
        editable_fields: undefined,
        review_settings: null,
      }),
      previousRequired: null, previousEditable: null, previousReview: null,
    });
    assert.equal(fields.allow_user_video_edits, flag);
    assert.equal(typeof fields.allow_user_video_edits, "number");
    assert.equal(fields.user_video_edit_permission_keys_json, null);
    assert.equal(fields.required_video_fields_json, null);
    assert.equal(fields.editable_fields, null);
    assert.equal(fields.review_settings, null);
  }
});

test("MIG-0652 U01: CURRENT questions adapter still handles serializers and permission/audit state", async () => {
  const current = await readFile(new URL("../../../src/lib/event/eventPayload.ts", import.meta.url), "utf8");
  const core = await readFile(new URL("../src/event/questionsUpdateFields.ts", import.meta.url), "utf8");
  assert.match(current, /if \(permissions\.questions\) \{\s*videoFormSettingsJson = buildVideoFormSettingsJson\(formData\)/);
  assert.match(current, /const requiredVideoFieldsJson = serializeRequiredVideoFieldsFromForm\(formData\)/);
  assert.match(current, /Object\.assign\(updatePayload, buildQuestionsEventUpdateFields\(\{/);
  assert.match(current, /previousRequiredVideoFieldsJson: before\.required_video_fields_json/);
  assert.match(current, /changedByPermission\.questions = EVENT_SECTION_PERMISSION_KEYS\.questions/);
  assert.match(current, /if \(permissions\.basic\)/);
  assert.match(current, /if \(permissions\.publish\)/);
  assert.match(current, /if \(permissions\.slots\)/);
  assert.doesNotMatch(core, /from ["']@\//, "no Next import in domain");
  assert.doesNotMatch(core, /drizzle|D1Database|\bsqlite\b/);
});

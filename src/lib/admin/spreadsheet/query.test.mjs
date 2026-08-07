import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSpreadsheetDisabledFeaturesJson } from "./disabledFeaturesCore.ts";

test("disabled_features_json accepts known WriteFeatureKeys", () => {
  assert.doesNotThrow(() =>
    validateSpreadsheetDisabledFeaturesJson('["edit_video","post_video_unslotted"]'),
  );
  assert.doesNotThrow(() => validateSpreadsheetDisabledFeaturesJson("[]"));
});

test("disabled_features_json rejects unknown feature keys", () => {
  assert.throws(
    () => validateSpreadsheetDisabledFeaturesJson('["not_a_real_feature"]'),
    /invalid_feature_key/,
  );
  assert.throws(
    () => validateSpreadsheetDisabledFeaturesJson('["edit_video","bogus"]'),
    /invalid_feature_key/,
  );
  assert.throws(
    () => validateSpreadsheetDisabledFeaturesJson('{"key":"value"}'),
    /invalid_feature_key/,
  );
});

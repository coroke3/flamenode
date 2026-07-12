import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STAGE_PERMISSION_FIELD,
  parseVideoFormSettings,
  resolveStagePermissionFieldsFromJson,
} from "./formSettings.ts";

test("parseVideoFormSettings returns empty settings for invalid JSON", () => {
  assert.deepEqual(parseVideoFormSettings("{bad"), {});
  assert.deepEqual(parseVideoFormSettings(""), {});
});

test("resolveStagePermissionFieldsFromJson enables field when any event enables it", () => {
  const resolved = resolveStagePermissionFieldsFromJson([
    JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: false }] }),
    JSON.stringify({
      stage_permissions: [{
        id: "stage_permission",
        enabled: true,
        required: false,
        label: "権利確認",
      }],
    }),
  ]);

  assert.equal(resolved[0]?.enabled, true);
  assert.equal(resolved[0]?.required, false);
  assert.equal(resolved[0]?.label, "権利確認");
});

test("resolveStagePermissionFieldsFromJson requires field when any event requires it", () => {
  const resolved = resolveStagePermissionFieldsFromJson([
    JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: true, required: false }] }),
    JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: true, required: true }] }),
  ]);

  assert.equal(resolved[0]?.required, true);
  assert.equal(resolved[0]?.placeholder, DEFAULT_STAGE_PERMISSION_FIELD.placeholder);
});

test("resolveStagePermissionFieldsFromJson hides field when no event enables it", () => {
  assert.deepEqual(
    resolveStagePermissionFieldsFromJson([
      JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: false }] }),
      "{}",
    ]),
    [],
  );
});

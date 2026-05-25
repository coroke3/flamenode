import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STAGE_PERMISSION_FIELD,
  parseVideoFormSettings,
  resolveStagePermissionFieldFromJson,
} from "./formSettings.ts";

test("parseVideoFormSettings returns empty settings for invalid JSON", () => {
  assert.deepEqual(parseVideoFormSettings("{bad"), {});
  assert.deepEqual(parseVideoFormSettings(""), {});
});

test("resolveStagePermissionFieldFromJson enables field when any event enables it", () => {
  const resolved = resolveStagePermissionFieldFromJson([
    JSON.stringify({ stage_permission: { enabled: false } }),
    JSON.stringify({
      stage_permission: {
        enabled: true,
        required: false,
        label: "権利確認",
      },
    }),
  ]);

  assert.equal(resolved?.enabled, true);
  assert.equal(resolved?.required, false);
  assert.equal(resolved?.label, "権利確認");
});

test("resolveStagePermissionFieldFromJson requires field when any event requires it", () => {
  const resolved = resolveStagePermissionFieldFromJson([
    JSON.stringify({ stage_permission: { enabled: true, required: false } }),
    JSON.stringify({ stage_permission: { enabled: true, required: true } }),
  ]);

  assert.equal(resolved?.required, true);
  assert.equal(resolved?.placeholder, DEFAULT_STAGE_PERMISSION_FIELD.placeholder);
});

test("resolveStagePermissionFieldFromJson hides field when no event enables it", () => {
  assert.equal(
    resolveStagePermissionFieldFromJson([
      JSON.stringify({ stage_permission: { enabled: false } }),
      "{}",
    ]),
    null,
  );
});

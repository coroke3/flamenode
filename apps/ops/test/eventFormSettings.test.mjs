// MIG-0721 U01b-2: source parity and CURRENT behavior regressions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_STAGE_PERMISSION_FIELD, createDefaultStagePermissionQuestion, filterImplicitEmptyStagePermissionQuestions, parseVideoFormSettings, resolveStagePermissionFieldsFromJson } from "../.test-dist/apps/ops/src/lib/event/formSettings.js";

test("U01b-2 keeps the exact CURRENT formSettings implementation", () => {
 const current = readFileSync(new URL("../../../../src/lib/video/formSettings.ts", import.meta.url), "utf8");
 const port = readFileSync(new URL("../src/lib/event/formSettings.ts", import.meta.url), "utf8");
 assert.ok(port.includes(current.trimEnd()), "migrated form settings helper diverged from CURRENT");
});
test("U01b-2 treats malformed settings as empty", () => {
 assert.deepEqual(parseVideoFormSettings("{bad"), {});
 assert.deepEqual(parseVideoFormSettings(""), {});
});
test("U01b-2 resolves enabled and required questions across events", () => {
 const resolved = resolveStagePermissionFieldsFromJson([
  JSON.stringify({stage_permissions:[{id:"stage_permission",enabled:false}]}),
  JSON.stringify({stage_permissions:[{id:"stage_permission",enabled:true,required:true,label:"権利確認"}]})
 ]);
 assert.equal(resolved.length, 1);
 assert.equal(resolved[0].enabled, true);
 assert.equal(resolved[0].required, true);
 assert.equal(resolved[0].label, "権利確認");
 assert.equal(resolved[0].placeholder, DEFAULT_STAGE_PERMISSION_FIELD.placeholder);
});
test("U01b-2 filters only the implicit disabled placeholder", () => {
 assert.deepEqual(filterImplicitEmptyStagePermissionQuestions([createDefaultStagePermissionQuestion()]), []);
 const configured = {...createDefaultStagePermissionQuestion(), enabled:true};
 assert.deepEqual(filterImplicitEmptyStagePermissionQuestions([configured]), [configured]);
});

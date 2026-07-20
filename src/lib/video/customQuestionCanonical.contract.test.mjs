import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function path(relative) {
  return fileURLToPath(new URL(relative, import.meta.url));
}

const customQuestions = readFileSync(path("./customQuestions.ts"), "utf8");
const templateSettings = readFileSync(
  path("../admin/eventTemplateSettings.ts"),
  "utf8",
);

test("stage_permissionと旧フォーム設定の互換モジュールを残さない", () => {
  for (const relative of [
    "./stagePermissionAnswers.ts",
    "./stagePermissionQuestions.ts",
    "./stagePermissionSubmission.ts",
    "./formSettings.ts",
    "./stagePermissionAnswers.test.mjs",
    "./stagePermissionQuestions.test.mjs",
    "./formSettings.test.mjs",
  ]) {
    assert.equal(existsSync(path(relative)), false, `${relative} must not exist`);
  }
});

test("質問型と公開範囲を既定値へ丸める互換関数を残さない", () => {
  assert.doesNotMatch(customQuestions, /normalizeQuestionKey/);
  assert.doesNotMatch(customQuestions, /parseQuestionType/);
  assert.doesNotMatch(customQuestions, /parseVisibility/);
  assert.doesNotMatch(customQuestions, /const legacy/);
});

test("テンプレートはschema v3のみを受理し旧形式を補正しない", () => {
  assert.match(templateSettings, /schema_version: 3/);
  assert.match(templateSettings, /parsed\.schema_version !== 3/);
  assert.doesNotMatch(templateSettings, /schema_version: 2/);
  assert.doesNotMatch(templateSettings, /Array\.isArray\(item\.options\)/);
  assert.doesNotMatch(templateSettings, /Number\(parsed\./);
});

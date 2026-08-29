import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./EventForm.tsx", import.meta.url), "utf8");

test("EventFormは質問未設定時に暗黙の1件を表示しない", () => {
  assert.match(source, /filterImplicitEmptyStagePermissionQuestions\(current\)/);
  assert.match(source, /filterImplicitEmptyStagePermissionQuestions\(readQuestions\(restored\)\)/);
  assert.doesNotMatch(
    source,
    /return current\.length \? current : \[createDefaultStagePermissionQuestion\(\)\]/,
  );
  assert.match(source, /custom_questions_present/);
});

test("EventForm wires general custom questions editor and draft restore", () => {
  assert.match(source, /EventCustomQuestionsEditor/);
  assert.match(source, /generalQuestions/);
  assert.match(source, /setGeneralQuestions/);
  assert.match(source, /readGeneralCustomQuestionsFromFormData/);
  assert.match(source, /generalCustomQuestionsPresent\(restored\)/);
  assert.match(source, /takeValues/);
  assert.match(source, /pendingValues/);
  assert.match(source, /カスタム質問/);
  assert.match(source, /ステージ・権利確認/);
  assert.match(source, /schemaVersion: "event-form-v3"/);
  assert.match(source, /custom_questions\?: EventGeneralCustomQuestionDraft\[\]/);
  assert.match(source, /questionTypeNeedsOptions\(question\.type\)/);
  assert.match(source, /normalizeOptionList\(question\.options\)/);
});

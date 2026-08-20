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

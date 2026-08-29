import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./EventCustomQuestionsEditor.tsx", import.meta.url),
  "utf8",
);
const draftSource = await readFile(
  new URL("../../lib/event/generalCustomQuestionDraft.ts", import.meta.url),
  "utf8",
);

test("EventCustomQuestionsEditor exposes Google Forms-like type and options fields", () => {
  assert.match(source, /general_custom_questions_present/);
  assert.match(source, /general_custom_question_type/);
  assert.match(source, /general_custom_question_options/);
  assert.match(source, /GENERAL_CUSTOM_QUESTION_TYPE_LABELS/);
  assert.match(draftSource, /選択（ボタン）/);
  assert.match(draftSource, /チェックボックス/);
  assert.match(draftSource, /プルダウン/);
  assert.match(source, /選択肢を追加/);
  assert.match(source, /createEmptyGeneralCustomQuestion/);
  assert.match(source, /styles\.typePicker/);
  assert.match(source, /aria-pressed=\{question\.type === value\}/);
  assert.match(source, /optionsForType/);
  assert.match(source, /moveQuestion/);
  assert.match(source, /duplicateQuestion/);
  assert.match(source, /moveOption/);
  assert.match(source, /複製/);
  assert.match(source, /投稿時の見え方/);
  assert.match(source, /CustomQuestionFields/);
  assert.match(source, /preview/);
  assert.match(source, /normalizeOptionList/);
  assert.match(source, /OPTION_MAX_LEN/);
  assert.match(source, /maxLength=\{120\}/);
});
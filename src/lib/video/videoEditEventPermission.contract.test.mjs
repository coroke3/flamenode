import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const editPage = read("../../../app/(auth)/dashboard/edit/[id]/page.tsx");
const updateAction = read("../actions/video/updateVideo.ts");

test("作品編集画面は専用のprimary_event権限でイベント操作を制御する", () => {
  assert.match(editPage, /computeAllowedVideoEditSections/);
  assert.match(editPage, /const canEditPrimaryEvent = sections\.primary_event/);
  assert.match(editPage, /canEditEvents=\{canEditPrimaryEvent\}/);
  assert.doesNotMatch(editPage, /canEditEvents=\{canEditIdentity\}/);
});

test("primary_eventだけを持つ利用者も編集可能セクションとして扱う", () => {
  assert.match(editPage, /hasAnyVideoEditSection\(sections\)/);
});

test("追加質問を編集できない場合は必須質問付きイベントの新規追加を拒否する", () => {
  assert.match(updateAction, /const addedEventIds = syncedEventIds\.filter/);
  assert.match(updateAction, /!sections\.descriptions && addedEventIds\.length > 0/);
  assert.match(updateAction, /fetchActiveCustomQuestionsForEvents\(db, addedEventIds\)/);
  assert.match(updateAction, /find\(\(question\) => question\.required\)/);
});

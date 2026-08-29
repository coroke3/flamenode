import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("投稿フォームは pending 反映前の二重送信を ref で拒否し、完了後に解放する", async () => {
  const [videoForm, membersForm, statusForm, approveActions, quickApprove] = await Promise.all([
    read("src/components/forms/VideoForm.tsx"),
    read("src/components/admin/AdminVideoMembersForm.tsx"),
    read("src/components/video/VideoStatusForm.tsx"),
    read("src/components/video/VideoApproveActions.tsx"),
    read("src/components/admin/VideoReviewQuickApproveButton.tsx"),
  ]);

  assert.match(videoForm, /submitInFlightRef\s*=\s*React\.useRef\(false\)/);
  assert.match(videoForm, /if \(pending \|\| submitInFlightRef\.current\) return/);
  assert.match(videoForm, /submitInFlightRef\.current\s*=\s*true/);
  assert.match(videoForm, /finally\s*\{[\s\S]*submitInFlightRef\.current\s*=\s*false/);
  assert.match(membersForm, /submitInFlightRef\s*=\s*React\.useRef\(false\)/);
  assert.match(membersForm, /if \(pending \|\| submitInFlightRef\.current\) return/);
  assert.match(membersForm, /submitInFlightRef\.current\s*=\s*true/);
  assert.match(membersForm, /finally\s*\{[\s\S]*submitInFlightRef\.current\s*=\s*false/);
  assert.match(membersForm, /redirectForGuardReason\(router, next\.reason, currentPath\)/);
  for (const source of [statusForm, approveActions, quickApprove]) {
    assert.match(source, /Ref\s*=\s*React\.useRef\(false\)/);
    assert.match(source, /Ref\.current\) return/);
    assert.match(source, /Ref\.current\s*=\s*true/);
    assert.match(source, /finally\s*\{[\s\S]*Ref\.current\s*=\s*false/);
  }
});

test("投稿フォームは予期しない action 例外を画面上のエラーへ変換する", async () => {
  const [videoForm, membersForm] = await Promise.all([
    read("src/components/forms/VideoForm.tsx"),
    read("src/components/admin/AdminVideoMembersForm.tsx"),
  ]);

  assert.match(videoForm, /catch \(error\)[\s\S]*setResult\(\{[\s\S]*ok:\s*false/);
  assert.match(membersForm, /catch \(error\)[\s\S]*setResult\(\{[\s\S]*ok:\s*false/);
  assert.match(membersForm, /role=\{result\.ok \? "status" : "alert"\}/);
});

test("一般カスタム質問は event/question key 付きの FormData 名で送信する", async () => {
  const source = await read("src/components/forms/VideoForm.tsx");
  assert.match(source, /custom_questions\?:\s*CustomQuestion\[\]/);
  assert.match(source, /custom_answer:\$\{event\.id\}:\$\{question\.question_key\}/);
  assert.match(source, /selectedCustomQuestions/);
  assert.match(source, /question\.required/);
  assert.match(source, /CustomQuestionFields/);
  assert.match(source, /questionTypeNeedsOptions\(question\.type\)/);
  assert.match(source, /acceptedCustomAnswerValues/);
  assert.match(source, /incompleteRequiredCustomQuestionCount/);
  assert.match(source, /validateCustomAnswerLimit/);
  assert.match(source, /MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS/);
});

test("編集画面は一般カスタム質問の既存回答を全件復元する", async () => {
  const source = await read("app/(auth)/dashboard/edit/[id]/page.tsx");
  assert.match(source, /fetchActiveCustomQuestionsForEvents/);
  assert.match(source, /custom_answers:\s*initialCustomAnswers/);
  assert.match(source, /D1_VIDEO_ANSWER_ID_CHUNK_SIZE = 80/);
  assert.match(source, /chunkIds\(\s*customQuestionIds/);
  assert.match(source, /\.limit\(questionIdChunk\.length\)/);
  assert.doesNotMatch(source, /customAnswerRows[\s\S]{0,900}\.limit\(5\)/);
});

test("submitter_change_denied の CTA は既存 query を URLSearchParams で保持する", async () => {
  const source = await read("src/components/ui/ErrorCallout.tsx");
  assert.match(source, /function withQueryParam/);
  assert.match(source, /params\.set\(key, value\)/);
  assert.match(source, /withQueryParam\(buildNext\(\), "privileged", "admin"\)/);
  assert.doesNotMatch(source, /\$\{buildNext\(\)\}\?privileged=admin/);
});

test("YouTube入力は生IDを送れるtext欄でサーバー検証へ委ねる", async () => {
  const source = await read("src/components/forms/VideoForm.tsx");
  const inputs = [...source.matchAll(/<input[\s\S]*?id=\"youtube_url\"[\s\S]*?\/>/g)];
  assert.equal(inputs.length, 2);
  for (const match of inputs) {
    assert.match(match[0], /type=\"text\"/);
    assert.match(match[0], /inputMode=\"url\"/);
  }
});

test("固定送信DockのグローバルボタンへCSS Modulesのスタイルを適用する", async () => {
  const source = await read("src/components/forms/VideoForm.module.css");
  assert.match(source, /\.submitDock\s+:global\(\.fn-btn\)/);
  assert.doesNotMatch(source, /\.submitDock\s+\.fn-btn\b/);
});

test("YouTube未設定の枠提出は公開導線と後付け編集導線を表示する", async () => {
  const source = await read("src/components/forms/VideoForm.tsx");
  assert.match(source, /mode === "slot" && !result\.youtubeVideoId/);
  assert.match(source, /YouTube URLが未設定でも作品情報は公開できます/);
  assert.match(source, /\(result\.youtubeVideoId \|\| result\.videoId\)/);
});

test("初回YouTube紐付け時は一般field設定由来のdisabled指定を解除する", async () => {
  const source = await read("app/(auth)/dashboard/edit/[id]/page.tsx");
  assert.match(
    source,
    /disabledFieldKeysFromGeneralFields\(generalFields\)\.filter\([\s\S]*allowInitialYoutubeAttach[\s\S]*video\.youtube_url/,
  );
});

test("投稿draftは成功時だけ消去し、画像はブラウザ側で復元する", async () => {
  const [videoForm, iconPicker, unslotted] = await Promise.all([
    read("src/components/forms/VideoForm.tsx"),
    read("src/components/forms/VideoIconPicker.tsx"),
    read("src/components/forms/UnslottedPostForm.tsx"),
  ]);
  assert.match(videoForm, /flushDraft\(\)/);
  assert.match(videoForm, /if \(r\.ok\) \{[\s\S]*clearVideoDraft\(\)/);
  assert.match(videoForm, /onSubmitSuccess\?\.\(\)/);
  assert.match(videoForm, /restoredUploadFile/);
  assert.match(videoForm, /loadDraftFile/);
  assert.match(videoForm, /saveDraftFile/);
  assert.match(videoForm, /restoreStaleVideoDraft/);
  assert.match(videoForm, /restoreStaleDraft\(\)[\s\S]{0,900}loadDraftFile/);
  assert.match(videoForm, /draftFileOperationRef/);
  assert.match(videoForm, /enqueueDraftFileOperation/);
  assert.match(videoForm, /const generation = \+\+draftFileRestoreGenerationRef\.current/);
  assert.match(iconPicker, /restoredUploadFile\?: File \| null/);
  assert.match(iconPicker, /onUploadFileChange\?: \(file: File \| null\)/);
  assert.match(unslotted, /unslotted-shell/);
  assert.match(unslotted, /onSubmitSuccess/);
  assert.doesNotMatch(videoForm, /clearVideoDraft\(\)[\s\S]{0,80}if \(!r\.ok/);
});

test("iPad Safariの固定Dockはタップ可能なネイティブボタンとしてフォールバックする", async () => {
  const source = await read("src/components/forms/VideoForm.module.css");
  assert.match(source, /\.submitDock\s*,\s*\n\.wizardDock\s*\{[\s\S]*pointer-events:\s*auto/);
  assert.match(source, /-webkit-appearance:\s*none/);
  assert.match(source, /touch-action:\s*manipulation/);
  assert.match(source, /@supports\s*\(-webkit-touch-callout:\s*none\)/);
  assert.match(source, /backdrop-filter:\s*none/);
  assert.match(source, /-webkit-backdrop-filter:\s*none/);
  assert.match(source, /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/);
  assert.match(source, /min-height:\s*var\(--fn-control-h-touch\)/);
});

test("枠付き作品の編集画面は部を読み取り専用にする", async () => {
  const [formSource, pageSource] = await Promise.all([
    read("src/components/forms/VideoForm.tsx"),
    read("app/(auth)/dashboard/edit/[id]/page.tsx"),
  ]);
  assert.match(formSource, /schedulingType\?:\s*"manual" \| "slotted" \| null/);
  assert.match(formSource, /schedulingType === "slotted"/);
  assert.match(formSource, /枠に設定された部を自動で使用します/);
  assert.match(formSource, /<input type="hidden" name="part" value=\{initial\.part \?\? ""\} \/>/);
  assert.match(pageSource, /schedulingType=\{video\.scheduling_type\}/);
});

test("member suggestion pagination aborts stale requests and ignores late responses", async () => {
  const source = await read("src/components/forms/VideoMembersField.tsx");
  assert.match(source, /suggestionRequestIdRef\s*=\s*React\.useRef\(0\)/);
  assert.match(source, /loadMoreControllerRef\s*=\s*React\.useRef<AbortController \| null>\(null\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /requestId !== suggestionRequestIdRef\.current/);
  assert.match(source, /fetchSuggestions\(searchQuery\.trim\(\), nextOffset, controller\.signal\)/);
});
test("admin/event privilege can clear an existing YouTube ID from the edit form", async () => {
  const source = await read("src/components/forms/VideoForm.tsx");
  assert.match(source, /const privilegedYoutubeEdit =/);
  assert.match(source, /privilegeMode !== "normal"/);
  assert.match(source, /youtube\.editable === true/);
  assert.match(
    source,
    /mode === "edit" && hasInitialYoutube && !privilegedYoutubeEdit/,
  );
});

test("wizard advances to confirmation and only its explicit button can submit", async () => {
  const [source, submitCompat] = await Promise.all([
    read("src/components/forms/VideoForm.tsx"),
    read("src/lib/forms/submitFormCompat.ts"),
  ]);
  assert.match(source, /const isWizardLastStep = isWizard && currentStepKey === "confirm"/);
  assert.match(source, /wizardConfirmSubmitRequestedRef = React\.useRef\(false\)/);
  assert.match(
    source,
    /if \(isWizard\) \{[\s\S]*if \(currentStepKey !== "confirm"\) \{[\s\S]*goWizardNext\(\);[\s\S]*return;/,
  );
  assert.match(
    source,
    /if \(!wizardConfirmSubmitRequestedRef\.current\) \{[\s\S]*「提出する」を押してください。[\s\S]*return;/,
  );
  assert.match(
    source,
    /const submitWizardFromConfirmation = \(\) => \{[\s\S]*submitFormCompat\(form\);/,
  );
  assert.match(submitCompat, /requestSubmit\.call\(form\)/);
  assert.match(submitCompat, /checkValidity\(\)/);
  assert.match(submitCompat, /dispatchEvent\(new Event\("submit"/);
  assert.match(
    source,
    /\{isWizardLastStep \?[\s\S]*type="button"[\s\S]*onClick=\{submitWizardFromConfirmation\}[\s\S]*: \([\s\S]*type="button"[\s\S]*onClick=\{goWizardNext\}/,
  );
});

test("YouTube policy permission remains visible in the edit UI", async () => {
  const source = await read("app/(auth)/dashboard/edit/[id]/page.tsx");
  assert.match(source, /const canEditYoutube = canEditYoutubeByPolicy \|\| allowInitialYoutubeAttach/);
});

test("v2 event policy fallback deny is preserved when the permission UI is edited", async () => {
  const source = await read("src/components/admin/PermissionKeysField.tsx");
  assert.match(source, /policy\.fallback === "deny"/);
  assert.match(source, /omittedState/);
  assert.match(source, /buildPermissionJson\(states\)/);
});

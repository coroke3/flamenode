import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readFromRoot = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("上映枠サマリーは全体+6部だけPCで7列固定しモバイル1列を維持する", async () => {
  const css = await readFromRoot("app/(public)/event/[id]/page.module.css");
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(
    css,
    /\.slotSummaryGrid:has\(> \.slotSummaryCard:nth-child\(7\):last-child\)/,
  );
  assert.match(
    css,
    /grid-template-columns:\s*minmax\(150px, 1\.35fr\) repeat\(6, minmax\(0, 1fr\)\)/,
  );
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.slotSummaryGrid \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(css, /nth-child\(8\):last-child/);
});

test("投稿Wizardは確認画面への遷移では送信せず明示ボタンだけで提出する", async () => {
  const [form, submitCompat] = await Promise.all([
    readFromRoot("src/components/forms/VideoForm.tsx"),
    readFromRoot("src/lib/forms/submitFormCompat.ts"),
  ]);
  assert.match(form, /wizardConfirmSubmitRequestedRef = React\.useRef\(false\)/);
  assert.match(
    form,
    /if \(currentStepKey !== "confirm"\) \{[\s\S]*goWizardNext\(\);[\s\S]*return;/,
  );
  assert.match(
    form,
    /if \(!wizardConfirmSubmitRequestedRef\.current\) \{[\s\S]*「提出する」を押してください。[\s\S]*return;/,
  );
  assert.match(form, /type="button"[\s\S]*onClick=\{submitWizardFromConfirmation\}/);
  assert.match(form, /if \(pending \|\| submitInFlightRef\.current\) return/);
  assert.match(submitCompat, /requestSubmit\.call\(form\)/);
  assert.match(submitCompat, /checkValidity\(\)/);
  assert.doesNotMatch(form, /form\.submit\(\)/);
});

test("枠なし投稿のActive X切替確認はVideoFormだけが担当し二重confirmを出さない", async () => {
  const [shell, form] = await Promise.all([
    readFromRoot("src/components/forms/UnslottedPostForm.tsx"),
    readFromRoot("src/components/forms/VideoForm.tsx"),
  ]);
  assert.doesNotMatch(shell, /ACTIVE_X_BEFORE_SWITCH_EVENT/);
  assert.doesNotMatch(shell, /addEventListener\(ACTIVE_X_BEFORE_SWITCH_EVENT/);
  assert.match(form, /addEventListener\(ACTIVE_X_BEFORE_SWITCH_EVENT/);
  assert.match(form, /flushDraft\(\)/);
});

test("概要欄管理Editorはプリセット・出力例コピー・レスポンシブ2ペインを持つ", async () => {
  const [editor, css] = await Promise.all([
    readFromRoot("src/components/admin/YoutubeDescriptionTemplateEditor.tsx"),
    readFromRoot("src/components/admin/YoutubeDescriptionTemplateEditor.module.css"),
  ]);
  for (const label of ["シンプル", "イベント標準", "合作", "合作＋チャプター"]) {
    assert.match(editor, new RegExp(label));
  }
  assert.match(editor, /window\.confirm/);
  assert.match(editor, /copyRenderedPreview/);
  assert.match(editor, /writeTextToClipboard\(rendered\.text\)/);
  assert.match(editor, /出力例をコピー/);
  assert.match(editor, /テンプレート本文をコピー/);
  assert.match(
    editor,
    /if \(next\.length > MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH\) \{[\s\S]*setLimitBlocked\(true\);[\s\S]*return false;/,
  );
  assert.doesNotMatch(
    editor,
    /next\.slice\(0, MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH\)/,
  );
  assert.match(editor, /既存の本文は変更していません/);
  assert.match(editor, /creator_x_id: "sample_creator"/);
  assert.match(editor, /@\{\{creator_x_id\}\}/);
  assert.match(editor, /className=\{styles\.workspace\}/);
  assert.match(editor, /className=\{styles\.previewColumn\}/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1\.25fr\) minmax\(300px, 0\.75fr\)/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*grid-template-columns:\s*1fr/);
});

test("投稿者向け概要欄は同じイベントの手動編集を保持しイベント切替時だけリセットする", async () => {
  const preview = await readFromRoot("src/components/forms/YoutubeDescriptionPreview.tsx");
  assert.match(preview, /useState<"auto" \| "manual">\("auto"\)/);
  assert.match(preview, /if \(draftMode === "auto"\)[\s\S]*setDraftText\(rendered\.text\)/);
  assert.match(preview, /sourceChangedWhileEditing/);
  assert.match(preview, /sourceIdentityRef = React\.useRef\(sourceIdentity\)/);
  assert.match(
    preview,
    /if \(sourceIdentityRef\.current === sourceIdentity\) return;[\s\S]*setDraftMode\("auto"\);[\s\S]*setDraftText\(rendered\.text\)/,
  );
  assert.match(preview, /context\.event_id \?\? eventTitle/);
  assert.match(preview, /最新の自動生成を反映/);
  assert.match(preview, /自動生成に戻す/);
  assert.match(preview, /作品情報が変わっても自動では上書きしません/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("uploadVideoIconCandidate は削除され x_users を作品経路から更新しない", () => {
  assert.throws(() => read("../actions/video/iconUpload.ts"), /ENOENT/);
  const videoExport = read("../actions/video.ts");
  assert.doesNotMatch(videoExport, /uploadVideoIconCandidate/);
  const picker = read("../../components/forms/VideoIconPicker.tsx");
  assert.doesNotMatch(picker, /uploadVideoIconCandidate/);
  assert.match(picker, /icon_mode/);
  assert.match(picker, /SquareIconEditor/);
  const resolve = read("./resolveVideoCreatorIcon.ts");
  assert.doesNotMatch(resolve, /xUsers|x_users/);
  assert.match(resolve, /video-icons\//);
  assert.match(resolve, /validateIconImageUpload/);
});

test("X ID 代表アイコンは validateIconImageUpload と orphan cleanup を使う", () => {
  const xid = read("../actions/xid.ts");
  assert.match(xid, /validateIconImageUpload/);
  assert.match(xid, /tryDeleteUnreferencedIcon/);
  assert.match(xid, /xicons\/staging\//);
});

test("SquareIconEditor は確定操作まで Server Action を呼ばない", () => {
  const editor = read("../../components/media/SquareIconEditor.tsx");
  assert.doesNotMatch(editor, /uploadXIdIcon|uploadVideoIcon/);
  assert.match(editor, /この画像を使用/);
  assert.match(editor, /role=\"status\"|aria-live/);
  assert.match(editor, /mountedRef/);
  assert.match(editor, /if \(!result\.ok\)/);
});

test("VideoIconPicker は upload 確定後のタブ切替と DataTransfer 失敗を扱う", () => {
  const picker = read("../../components/forms/VideoIconPicker.tsx");
  assert.match(picker, /switchToSelectTab/);
  assert.match(picker, /iconMode === "upload"/);
  assert.match(picker, /discardUploadState/);
  assert.match(picker, /fileInputRef\.current\?\.files\?\.length/);
  assert.match(picker, /persistedIconUrl/);
  assert.match(picker, /selectionBeforeUploadRef/);
  assert.match(picker, /return \{ ok: true \}/);
});

test("XIdSettingsClient は SquareIconEditor 経由で uploadXIdIcon を呼ぶ", () => {
  const settings = read("../../components/settings/XIdSettingsClient.tsx");
  assert.match(settings, /SquareIconEditor/);
  assert.match(settings, /uploadXIdIcon/);
  assert.match(settings, /onUseImage=\{onUploadProcessedFile\}/);
  assert.doesNotMatch(
    settings,
    /type=\"file\"[\s\S]*onChange[\s\S]*uploadXIdIcon/,
  );
  assert.match(settings, /onUploadProcessedFile/);
  assert.match(settings, /resolve\(\{ ok: true \}\)/);
  assert.match(settings, /resolve\(\{ ok: false, message \}\)/);
  assert.match(settings, /if \(pending\) \{[\s\S]*return \{ ok: false, message:/);
  assert.match(settings, /disabled=\{pending\}/);
  assert.match(settings, /role=\"status\"/);
  assert.match(settings, /role=\"alert\"/);
  assert.match(settings, /savedIconUrl/);
  assert.match(settings, /保存済み画像を表示/);
  assert.match(settings, /msgOk[\s\S]*role=\"status\"/);
  assert.match(settings, /msgErr[\s\S]*role=\"alert\"/);
  assert.match(settings, /const onSelect[\s\S]*if \(pending\) return/);
});

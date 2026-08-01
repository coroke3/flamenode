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
});

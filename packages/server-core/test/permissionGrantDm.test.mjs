import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPermissionGrantDm } from "../src/video/permissionGrantDm.ts";

test("SA-082 grant DM preserves CURRENT exact content and metadata with host origin", () => {
  const editUrl = "https://flamenode.example/dashboard/edit/v1";
  assert.deepEqual(buildPermissionGrantDm({
    videoId: "v1", videoTitle: "My Video", editUrl,
  }), {
    content: [
      "【FlameNode】作品の編集権限が付与されました",
      "作品「My Video」を共同編集できるようになりました。\nタイトル・紹介文・メンバー情報など、許可された範囲を編集できます。",
      "■ 次に行うこと",
      "編集画面を開き、担当範囲の修正を行ってください。\n編集画面を開く\nhttps://flamenode.example/dashboard/edit/v1",
    ].join("\n\n"),
    video_id: "v1",
    url: editUrl,
  });
});

test("SA-082 DM escapes Discord mentions and angle syntax without changing its URL", () => {
  const editUrl = "https://flamenode.example/dashboard/edit/vid";
  const result = buildPermissionGrantDm({
    videoId: "vid", videoTitle: "@everyone <@123> > demo", editUrl,
  });
  assert.ok(result.content.includes("@\u200beveryone"));
  assert.ok(result.content.includes("\\<@\u200b123\\>"));
  assert.ok(result.content.includes("\\> demo"));
  assert.equal(result.url, editUrl);
  assert.equal(result.video_id, "vid");
  assert.equal(Object.keys(result).join(","), "content,video_id,url");
});

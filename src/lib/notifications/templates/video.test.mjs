import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";

  const {
    buildChannelVideoRegisteredNotification,
    buildVideoRegisteredOpsThreadName,
    buildVideoEditPermissionGrantedNotification,
  } = await import("./video.ts");

  const actor = {
    userId: "user-1",
    discordId: "discord-1",
    discordName: "Discord Name",
    activeXId: "active_x",
    activeXName: "Active X Name",
  };

  test("SA-082 共同編集権限付与DMは検証済みoriginとshared templateを使用する", () => {
    const payload = buildVideoEditPermissionGrantedNotification({
      videoId: "v1", videoTitle: "@everyone video",
    });
    assert.deepEqual(payload, {
      content: [
        "【FlameNode】作品の編集権限が付与されました",
        "作品「@\u200beveryone video」を共同編集できるようになりました。\nタイトル・紹介文・メンバー情報など、許可された範囲を編集できます。",
        "■ 次に行うこと",
        "編集画面を開き、担当範囲の修正を行ってください。\n編集画面を開く\nhttps://example.test/dashboard/edit/v1",
      ].join("\n\n"),
      video_id: "v1",
      url: "https://example.test/dashboard/edit/v1",
    });
  });

  test("buildVideoRegisteredOpsThreadName は作品タイトルと操作者を含む", () => {
    assert.equal(
      buildVideoRegisteredOpsThreadName("新作動画", actor),
      "[作品登録] 新作動画 / @active_x",
    );
  });

  test("buildChannelVideoRegisteredNotification は操作者と作品表示名を分離する", () => {
    const payload = buildChannelVideoRegisteredNotification({
      videoId: "video-1",
      videoTitle: "新作動画",
      youtubeVideoId: "yt-1",
      registrationKind: "slot",
      eventId: "event-1",
      eventTitle: "夏イベント",
      actor,
      creatorDisplayName: "作品表示名",
    });
    assert.match(payload.content, /作品名: 新作動画/);
    assert.match(payload.content, /登録種別: 枠投稿/);
    assert.match(payload.content, /イベント: 夏イベント/);
    assert.match(payload.content, /■ 操作者/);
    assert.match(payload.content, /Active X: Active X Name \(@\u200bactive_x\)/);
    assert.match(payload.content, /■ 作品の表示名/);
    assert.match(payload.content, /作品表示名/);
    assert.doesNotMatch(payload.content, /作品表示名[\s\S]*■ 操作者/);
  });

  test("buildChannelVideoRegisteredNotification: creatorDisplayName 省略時は作品表示名ブロックなし", () => {
    const payload = buildChannelVideoRegisteredNotification({
      videoId: "video-1",
      videoTitle: "新作動画",
      registrationKind: "unaffiliated",
      actor,
    });
    assert.doesNotMatch(payload.content, /■ 作品の表示名/);
  });
}

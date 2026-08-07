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
  } = await import("./video.ts");

  const actor = {
    userId: "user-1",
    discordId: "discord-1",
    discordName: "Discord Name",
    activeXId: "active_x",
    activeXName: "Active X Name",
  };

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
    assert.match(payload.content, /Active X: Active X Name \(active_x\)/);
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

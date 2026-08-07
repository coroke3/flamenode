import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";

  const { buildChannelAccountCreatedNotification } = await import("./channel.ts");

  test("buildChannelAccountCreatedNotification は Active X 未設定を含む", () => {
    const payload = buildChannelAccountCreatedNotification({
      userId: "user-1",
      discordId: "discord-1",
      discordName: "Discord User",
      activeXId: null,
      activeXName: null,
    });
    assert.match(payload.content, /Discord: Discord User \(discord-1\)/);
    assert.match(payload.content, /user_id: user-1/);
    assert.match(payload.content, /Active X: 未設定/);
    assert.match(payload.content, /ユーザー管理を開く/);
  });

  test("buildChannelAccountCreatedNotification は Active X 設定時に表示名を含む", () => {
    const payload = buildChannelAccountCreatedNotification({
      userId: "user-1",
      discordId: "discord-1",
      discordName: "Discord User",
      activeXId: "creator_x",
      activeXName: "Creator Name",
    });
    assert.match(payload.content, /Active X: Creator Name \(creator_x\)/);
  });
}

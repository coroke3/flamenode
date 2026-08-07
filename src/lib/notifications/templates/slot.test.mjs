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
    buildChannelSlotReservedNotification,
    buildSlotReservedOpsThreadName,
  } = await import("./slot.ts");

  const actor = {
    userId: "user-1",
    discordId: "discord-1",
    discordName: "Discord Name",
    activeXId: "active_x",
    activeXName: "Active X Name",
  };

  test("buildSlotReservedOpsThreadName は active X を優先する", () => {
    assert.equal(
      buildSlotReservedOpsThreadName("夏イベント", actor),
      "[枠確保] 夏イベント / @active_x",
    );
  });

  test("buildSlotReservedOpsThreadName: active X なしは Discord 名", () => {
    assert.equal(
      buildSlotReservedOpsThreadName("夏イベント", {
        ...actor,
        activeXId: null,
        activeXName: null,
      }),
      "[枠確保] 夏イベント / Discord Name",
    );
  });

  test("buildChannelSlotReservedNotification は操作者と予約表示名を分離する", () => {
    const payload = buildChannelSlotReservedNotification({
      eventId: "event-1",
      eventTitle: "夏イベント",
      slotCount: 3,
      slotDisplayName: "枠表示名",
      actor,
    });
    assert.match(payload.content, /イベント: 夏イベント/);
    assert.match(payload.content, /確保枠: 3 枠/);
    assert.match(payload.content, /■ 操作者/);
    assert.match(payload.content, /Active X: Active X Name \(@\u200bactive_x\)/);
    assert.match(payload.content, /■ 予約上の表示名/);
    assert.match(payload.content, /枠表示名/);
    assert.doesNotMatch(payload.content, /枠表示名[\s\S]*■ 操作者/);
  });
}

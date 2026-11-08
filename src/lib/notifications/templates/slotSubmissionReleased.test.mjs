import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
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
  const { buildSlotForceReleasedNotification, buildSlotSubmissionReleasedNotification } = await import("./slot.ts");

  test("提出解除通知は予約維持と再提出導線を明示する", () => {
    const payload = buildSlotSubmissionReleasedNotification({
      eventId: "event-1",
      eventTitle: "イベント",
      slotIds: ["slot-1", "slot-2"],
      reservationGroupId: "group-1",
    });
    assert.match(payload.content, /作品提出が解除されました/);
    assert.match(payload.content, /予約枠自体は引き続き確保されています/);
    assert.match(payload.content, /提出グループ: group-1/);
    assert.match(payload.content, /event-1/);
  });
  test("枠解放・提出解除DMのlegacy予約グループIDを本文だけエスケープする", () => {
    const groupId = "legacy@everyone<@123456789>";
    const cases = [
      ["予約グループ", buildSlotForceReleasedNotification],
      ["提出グループ", buildSlotSubmissionReleasedNotification],
    ];
    for (const [prefix, build] of cases) {
      const payload = build({
        eventId: "event-1",
        eventTitle: "イベント",
        slotIds: ["slot-1", "slot-2"],
        reservationGroupId: groupId,
      });
      assert.ok(payload.content.includes(prefix + ": legacy@\u200beveryone"));
      assert.ok(payload.content.includes("\\<@\u200b123456789\\>"));
      assert.ok(!payload.content.includes(prefix + ": " + groupId));
      assert.equal(payload.event_id, "event-1");
      assert.equal(payload.url.includes("/event/event-1"), true);
    }
  });

  test("枠解放・提出解除DMは@here、role/user形式のメンションも無害化する", () => {
    const groupIds = [
      "@here",
      "<@&123456789>",
      "<@!123456789>",
      "<@123456789>",
      "@everyone @here",
    ];
    for (const build of [
      buildSlotForceReleasedNotification,
      buildSlotSubmissionReleasedNotification,
    ]) {
      for (const reservationGroupId of groupIds) {
        const payload = build({
          eventId: "event-1",
          slotIds: ["slot-1"],
          reservationGroupId,
        });
        assert.ok(!payload.content.includes(reservationGroupId), reservationGroupId);
        assert.ok(payload.content.includes("@\u200b") || payload.content.includes("\\<"), reservationGroupId);
        assert.equal(payload.event_id, "event-1");
      }
    }
  });

  test("通常のグループID表示は変更しない", () => {
    for (const build of [
      buildSlotForceReleasedNotification,
      buildSlotSubmissionReleasedNotification,
    ]) {
      const payload = build({
        eventId: "event-1",
        slotIds: ["slot-1"],
        reservationGroupId: "sgrp_safe-123",
      });
      assert.match(payload.content, /グループ: sgrp_safe-123/);
    }
  });

}

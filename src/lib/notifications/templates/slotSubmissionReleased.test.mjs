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
  const { buildSlotSubmissionReleasedNotification } = await import("./slot.ts");

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
}

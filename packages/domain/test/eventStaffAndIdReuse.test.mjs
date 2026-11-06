import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_ID_REUSE_DELAY_SECONDS,
  eventIdRenameCleanupTargets,
  hasCompletedEventIdRenameCleanup,
  isEventIdReuseDelayElapsed,
  parseEventStaffPermissionKeys,
} from "@flamenode/domain/event";

test("parseEventStaffPermissionKeys trims, drops blanks and dedupes", () => {
  assert.deepEqual(parseEventStaffPermissionKeys(" event.basic, ,event.slots,event.basic "), [
    "event.basic",
    "event.slots",
  ]);
  assert.deepEqual(parseEventStaffPermissionKeys(null), []);
  assert.deepEqual(parseEventStaffPermissionKeys(""), []);
});

test("parseEventStaffPermissionKeys keeps legacy aliases as submitted", () => {
  assert.deepEqual(parseEventStaffPermissionKeys("videos.title"), ["videos.title"]);
});

test("parseEventStaffPermissionKeys rejects the whole input on an unknown key", () => {
  assert.throws(
    () => parseEventStaffPermissionKeys("event.basic,not.a.key"),
    /不正な権限キーです: not\.a\.key/,
  );
});

test("event id reuse waits the full delay and needs every cleanup target done", () => {
  assert.equal(isEventIdReuseDelayElapsed(100, 100 + EVENT_ID_REUSE_DELAY_SECONDS - 1), false);
  assert.equal(isEventIdReuseDelayElapsed(100, 100 + EVENT_ID_REUSE_DELAY_SECONDS), true);
  assert.equal(isEventIdReuseDelayElapsed(null, 100), false);
  assert.equal(hasCompletedEventIdRenameCleanup("ev", []), false);
});

test("event id reuse fails closed on conflicting same-second cleanup history", () => {
  const targets = eventIdRenameCleanupTargets("ev");
  const complete = targets.map((target) => ({
    ...target,
    status: "done",
    updatedAt: 10,
  }));
  const failed = { ...targets[0], status: "failed", updatedAt: 10 };
  assert.equal(hasCompletedEventIdRenameCleanup("ev", [...complete, failed]), false);
  assert.equal(hasCompletedEventIdRenameCleanup("ev", [failed, ...complete]), false);
  assert.equal(
    hasCompletedEventIdRenameCleanup("ev", [
      ...complete,
      failed,
      { ...targets[0], status: "done", updatedAt: 11 },
    ]),
    true,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_ID_RENAME_CLEANUP_TARGETS,
  EVENT_ID_REUSE_DELAY_SECONDS,
  eventIdRenameCleanupTargets,
  hasCompletedEventIdRenameCleanup,
  isEventIdReuseDelayElapsed,
} from "./eventIdReuseCore.ts";

test("event ID reuse waits for the retention window", () => {
  assert.equal(
    isEventIdReuseDelayElapsed(100, 100 + EVENT_ID_REUSE_DELAY_SECONDS - 1),
    false,
  );
  assert.equal(
    isEventIdReuseDelayElapsed(100, 100 + EVENT_ID_REUSE_DELAY_SECONDS),
    true,
  );
  assert.equal(isEventIdReuseDelayElapsed(null, 100000), false);
});

test("cleanup requires every event-specific and global target to be done", () => {
  const rows = eventIdRenameCleanupTargets("old-id").map((target, index) => ({
    ...target,
    status: "done",
    updatedAt: index + 1,
  }));
  assert.equal(hasCompletedEventIdRenameCleanup("old-id", rows), true);
  rows[rows.length - 1].status = "failed";
  assert.equal(hasCompletedEventIdRenameCleanup("old-id", rows), false);
});

test("a newer cleanup attempt wins over an older failed attempt", () => {
  const targets = eventIdRenameCleanupTargets("old-id");
  const rows = targets.flatMap((target) => [
    { ...target, status: "failed", updatedAt: 1 },
    { ...target, status: "done", updatedAt: 2 },
  ]);
  assert.equal(hasCompletedEventIdRenameCleanup("old-id", rows), true);
  assert.equal(EVENT_ID_RENAME_CLEANUP_TARGETS.length, 10);
});

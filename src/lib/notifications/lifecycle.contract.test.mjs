import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const statusSource = await readFile(new URL("./status.ts", import.meta.url), "utf8");
const displaySource = await readFile(new URL("./display.ts", import.meta.url), "utf8");
const adminActionSource = await readFile(
  new URL("../actions/notification-admin.ts", import.meta.url),
  "utf8",
);
const userAdminSource = await readFile(
  new URL("../actions/user-admin.ts", import.meta.url),
  "utf8",
);
const adminPageSource = await readFile(
  new URL("../../../app/(admin)/admin/notifications/page.tsx", import.meta.url),
  "utf8",
);
const managePageSource = await readFile(
  new URL("../../../app/(manage)/manage/notifications/page.tsx", import.meta.url),
  "utf8",
);

test("failed and dead_letter share one terminal failure policy", () => {
  assert.match(statusSource, /"failed",\s*\n\s*"dead_letter"/);
  assert.match(statusSource, /isTerminalNotificationFailure/);
  assert.match(displaySource, /dead_letter: "最終失敗"/);
  assert.match(displaySource, /case "dead_letter":/);
  assert.match(adminActionSource, /TERMINAL_NOTIFICATION_FAILURE_STATUSES/);
  assert.match(adminActionSource, /isTerminalNotificationFailure\(row\.status\)/);
  assert.match(managePageSource, /TERMINAL_NOTIFICATION_FAILURE_STATUSES/);
});

test("notification opt-out cancels the exact pending delivery count atomically", () => {
  assert.match(userAdminSource, /select\(\{ count: sql<number>`COUNT\(\*\)` \}\)/);
  assert.match(userAdminSource, /update\(notificationOutbox\)/);
  assert.match(userAdminSource, /eq\(notificationOutbox\.status, "pending"\)/);
  assert.match(userAdminSource, /status: "cancelled"/);
  assert.match(userAdminSource, /notification disabled before delivery/);
  assert.match(userAdminSource, /extraExpectedChanges: pendingCancellation \? \[pendingCount\]/);
  assert.doesNotMatch(userAdminSource, /extraExpectedChanges: pendingCancellation \? \[null\]/);
});

test("admin notification UI matches the free-plan dispatcher contract", () => {
  assert.match(adminPageSource, /1回最大6件/);
  assert.match(adminPageSource, /最大4回試行/);
  assert.match(adminPageSource, /lte\(notificationOutbox\.lease_expires_at, now\)/);
  assert.doesNotMatch(adminPageSource, /1 回最大 50 件|15分以上 processing/);
  assert.match(adminPageSource, /isTerminalNotificationFailure\(row\.status\)/);
});

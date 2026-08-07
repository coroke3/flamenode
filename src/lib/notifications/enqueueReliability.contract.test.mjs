import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [
  createFreeVideo,
  submitSlotVideo,
  adminVideo,
  manageVideo,
  rules,
  slot,
  videoVisibilityTransition,
  enqueue,
] = await Promise.all([
  readFile(new URL("../actions/video/createFreeVideo.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/video/submitSlotVideo.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/manage-video.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/rules.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/slot.ts", import.meta.url), "utf8"),
  readFile(new URL("../video/videoVisibilityTransition.ts", import.meta.url), "utf8"),
  readFile(new URL("./enqueue.ts", import.meta.url), "utf8"),
]);

test("onConflictDoNothing notification inserts use null expected changes when in-batch", () => {
  assert.match(enqueue, /onConflictDoNothing\(\)/);
  assert.match(
    createFreeVideo,
    /notification\.statement[\s\S]*?plan\.expectedChanges\.push\(null\)/,
  );
  assert.doesNotMatch(
    createFreeVideo,
    /notification\.statement[\s\S]*?expected(?:Mutation)?Changes\.push\(1\)/,
  );
});

test("slot and submit notifications enqueue post-commit with queue wake", () => {
  assert.match(submitSlotVideo, /runPostCommitBestEffort/);
  assert.match(submitSlotVideo, /slot_submit_notifications/);
  assert.match(submitSlotVideo, /buildNotificationOutboxStatement/);
  assert.match(submitSlotVideo, /wakeNotificationQueueAfterCommit\("web"\)/);
  assert.doesNotMatch(submitSlotVideo, /notificationWakeSource:/);

  assert.match(slot, /runPostCommitBestEffort/);
  assert.match(slot, /ops_webhook_notification/);
  assert.match(slot, /buildOpsChannelWebhookStatement/);
  assert.match(slot, /wakeNotificationQueueAfterCommit\("web"\)/);
  assert.doesNotMatch(slot, /notificationWakeSource:/);
  assert.doesNotMatch(slot, /extra\.map\(\(\) => null\)/);
});

test("video status mutations enqueue notifications post-commit", () => {
  assert.match(
    videoVisibilityTransition,
    /export async function enqueueVideoVisibilityNotificationsPostCommit/,
  );
  assert.match(
    videoVisibilityTransition,
    /wakeNotificationQueueAfterCommit\(context\.wakeSource\)/,
  );
  assert.match(adminVideo, /enqueueVideoVisibilityNotificationsPostCommit/);
  assert.match(manageVideo, /enqueueVideoVisibilityNotificationsPostCommit/);
  assert.doesNotMatch(adminVideo, /notificationWakeSource:/);
  assert.doesNotMatch(manageVideo, /notificationWakeSource:/);
});

test("terms reaccept broadcast does not enqueue Discord DM", () => {
  assert.doesNotMatch(rules, /buildKnownRecipientNotificationBatch/);
  assert.doesNotMatch(rules, /type:\s*"terms_reaccept_required"/);
  assert.match(rules, /Discord DM は送信しません/);
});

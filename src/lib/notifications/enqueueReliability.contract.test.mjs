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

test("slot and submit notifications enqueue in atomic batch with queue wake", () => {
  assert.match(submitSlotVideo, /buildNotificationOutboxStatement/);
  assert.match(submitSlotVideo, /executeVideoAtomicWritePlan/);
  assert.match(submitSlotVideo, /notificationWakeSource/);
  assert.doesNotMatch(submitSlotVideo, /await enqueueSlotSubmitNotificationsPostCommit/);

  assert.match(slot, /enqueueSlotReserveOpsWebhookPostCommit/);
  assert.match(slot, /runPostCommitBestEffort/);
  assert.match(slot, /notificationWakeSource/);
  assert.match(slot, /\.\.\.extra\.map\(\(\) => null\)/);
});

test("video status mutations enqueue notifications in atomic batch", () => {
  assert.match(
    videoVisibilityTransition,
    /export async function enqueueVideoVisibilityNotificationsPostCommit/,
  );
  assert.match(
    videoVisibilityTransition,
    /wakeNotificationQueueAfterCommit\(context\.wakeSource\)/,
  );
  assert.doesNotMatch(
    videoVisibilityTransition,
    /mutationStatements\.push\(\s*\.\.\.notificationBatch\.statements/,
  );

  assert.match(adminVideo, /executeVideoVisibilityStatusMutation/);
  assert.match(
    adminVideo,
    /notificationWakeSource:\s*[\s\S]*transition\.notificationBatch\.statements\.length > 0 \? "admin" : undefined/,
  );
  assert.doesNotMatch(adminVideo, /enqueueVideoVisibilityNotificationsPostCommit/);

  assert.match(manageVideo, /executeVideoVisibilityStatusMutation/);
  assert.match(
    manageVideo,
    /notificationWakeSource:\s*[\s\S]*transition\.notificationBatch\.statements\.length > 0 \? "manage" : undefined/,
  );
  assert.doesNotMatch(manageVideo, /enqueueVideoVisibilityNotificationsPostCommit/);
});

test("terms reaccept broadcast does not enqueue Discord DM", () => {
  assert.doesNotMatch(rules, /buildKnownRecipientNotificationBatch/);
  assert.doesNotMatch(rules, /type:\s*"terms_reaccept_required"/);
  assert.match(rules, /Discord DM は送信しません/);
});

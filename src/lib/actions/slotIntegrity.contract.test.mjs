import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = async (relative) =>
  readFile(new URL(relative, import.meta.url), "utf8");

test("reserveSlot keeps ops webhook post-commit and out of atomic batch", async () => {
  const source = await read("./slot.ts");
  assert.match(source, /name: "ops_webhook_notification"/);
  assert.match(source, /runPostCommitBestEffort/);
  assert.doesNotMatch(source, /extraStatements/);
  assert.doesNotMatch(
    source,
    /commitSlotUpdates\([\s\S]*notificationWakeSource/,
  );
});

test("submitSlotVideo keeps submit notifications post-commit", async () => {
  const source = await read("./video/submitSlotVideo.ts");
  assert.match(source, /name: "slot_submit_notifications"/);
  assert.match(source, /runPostCommitBestEffort/);
  assert.doesNotMatch(
    source,
    /executeVideoAtomicWritePlan\([\s\S]*notificationWakeSource/,
  );
  assert.match(
    source,
    /catch \(error\) \{[\s\S]*rollbackUploadedVideoIcon/,
  );
});

test("setVideoStatus returns ok:false on D1 mutation failure", async () => {
  const source = await read("./admin.ts");
  assert.match(source, /handleVideoVisibilityMutationFailure/);
  assert.match(
    source,
    /catch \(error\) \{[\s\S]*return handleVideoVisibilityMutationFailure/,
  );
});

test("setManageVideoStatus returns ok:false on D1 mutation failure", async () => {
  const source = await read("./manage-video.ts");
  assert.match(source, /handleVideoVisibilityMutationFailure/);
  assert.match(source, /unstable_rethrow\(error\)/);
});

test("visibility transition separates DM notifications from canonical mutation", async () => {
  const source = await read("../video/videoVisibilityTransition.ts");
  assert.match(source, /enqueueVideoVisibilityNotificationsPostCommit/);
  assert.doesNotMatch(
    source,
    /mutationStatements\.push\(\s*\.\.\.notificationBatch\.statements/,
  );
  assert.match(source, /compensateDepublicizationFenceOnD1Failure/);
  assert.match(source, /releaseBlockedEntityInManifest/);
});

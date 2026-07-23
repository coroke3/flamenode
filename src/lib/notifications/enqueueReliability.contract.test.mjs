import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [createFreeVideo, submitSlotVideo, adminVideo, manageVideo, rules, slot] =
  await Promise.all([
    readFile(new URL("../actions/video/createFreeVideo.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/video/submitSlotVideo.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/manage-video.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../actions/slot.ts", import.meta.url), "utf8"),
  ]);

test("onConflictDoNothing notification inserts use null expected changes", () => {
  assert.match(
    createFreeVideo,
    /notification\.statement[\s\S]*?plan\.expectedChanges\.push\(null\)/,
  );
  assert.match(
    submitSlotVideo,
    /notification\.statement[\s\S]*?plan\.expectedChanges\.push\(null\)/,
  );
  assert.match(slot, /channelNotification\.statement/);
  assert.match(slot, /extra\.map\(\(\) => null\)/);
  for (const source of [createFreeVideo, submitSlotVideo]) {
    assert.doesNotMatch(
      source,
      /notification\.statement[\s\S]*?expected(?:Mutation)?Changes\.push\(1\)/,
    );
  }
});

test("video status mutations wake notification queue when outbox rows are added", () => {
  assert.match(
    adminVideo,
    /notificationWakeSource:\s*\n\s*notification\.statements\.length > 0 \? "admin" : undefined/,
  );
  assert.match(
    manageVideo,
    /notificationWakeSource:\s*\n\s*notification\.statements\.length > 0 \? "manage" : undefined/,
  );
});

test("terms reaccept broadcast does not enqueue Discord DM", () => {
  assert.doesNotMatch(rules, /buildKnownRecipientNotificationBatch/);
  assert.doesNotMatch(rules, /type:\s*"terms_reaccept_required"/);
  assert.match(rules, /Discord DM は送信しません/);
});

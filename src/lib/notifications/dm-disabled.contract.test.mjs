/**
 * DM 停止対象の enqueue が呼び出し元から除去されていることを検証する契約テスト。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const files = {
  chapter: new URL("../actions/chapter.ts", import.meta.url),
  moderation: new URL("../actions/moderation-admin.ts", import.meta.url),
  rules: new URL("../actions/rules.ts", import.meta.url),
  videoStatus: new URL("./videoStatusNotify.ts", import.meta.url),
};

test("chapter_comment_added は enqueue しない", async () => {
  const source = await readFile(files.chapter, "utf8");
  assert.doesNotMatch(source, /type:\s*"chapter_comment_added"/);
  assert.doesNotMatch(source, /buildNotificationOutboxStatement/);
});

test("moderation 系 DM は enqueue しない", async () => {
  const source = await readFile(files.moderation, "utf8");
  assert.doesNotMatch(source, /type:\s*"moderation_/);
  assert.doesNotMatch(source, /buildNotificationOutboxStatement/);
});

test("terms_reaccept_required は enqueue しない", async () => {
  const source = await readFile(files.rules, "utf8");
  assert.doesNotMatch(source, /type:\s*"terms_reaccept_required"/);
  assert.doesNotMatch(source, /buildKnownRecipientNotificationBatch/);
});

test("force 時の video_status_changed DM は送信しない", async () => {
  const source = await readFile(files.videoStatus, "utf8");
  assert.doesNotMatch(source, /video_status_changed/);
  assert.doesNotMatch(source, /force \? "video_status_changed"/);
});

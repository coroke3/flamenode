import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const wakeSource = await readFile(
  new URL("../../../packages/server-core/src/queues/youtubeSyncWake.ts", import.meta.url),
  "utf8",
);
const sendSource = await readFile(
  new URL("../../../packages/server-core/src/queues/sendQueueWakeBestEffort.ts", import.meta.url),
  "utf8",
);

test("youtube pending wake helper は requireYoutubeFlag 付き send を使う", () => {
  assert.match(wakeSource, /sendQueueWakeBestEffort/);
  assert.match(wakeSource, /kind:\s*"youtube_sync_pending"/);
  assert.match(wakeSource, /requireYoutubeFlag:\s*true/);
  assert.match(sendSource, /requireYoutubeFlag && !flags\.youtubeSyncEnabled/);
});

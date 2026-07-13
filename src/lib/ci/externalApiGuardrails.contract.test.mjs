import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const youtube = await readFile(
  new URL("../../../workers/youtube-sync/index.ts", import.meta.url),
  "utf8",
);
const discord = await readFile(
  new URL("../../../workers/notification-dispatcher/dispatch.ts", import.meta.url),
  "utf8",
);
const imageProxy = await readFile(
  new URL("../media/externalImageProxy.ts", import.meta.url),
  "utf8",
);

test("外部API処理は固定予算・timeout・provider cooldownを持つ", () => {
  assert.match(youtube, /YOUTUBE_MAX_QUOTA_UNITS_PER_RUN = 2/);
  assert.match(youtube, /YOUTUBE_QUOTA_COOLDOWN_KEY/);
  assert.match(youtube, /fields/);
  assert.match(discord, /MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN = 12/);
  assert.match(discord, /MAX_DISCORD_DM_KV_WRITES_PER_RUN = 2/);
  assert.match(discord, /DISCORD_GLOBAL_COOLDOWN_KEY/);
  assert.match(discord, /next_attempt_at/);
  assert.match(imageProxy, /inFlight/);
  assert.match(imageProxy, /if-none-match/);
  assert.match(imageProxy, /maxObjectBytes/);
});

test("外部API処理は無制限retryを持たない", () => {
  assert.doesNotMatch(discord, /while \(true\)/);
  assert.doesNotMatch(imageProxy, /while \(true\)/);
  assert.match(youtube, /YOUTUBE_SYNC_MAX_ATTEMPTS = 2/);
});

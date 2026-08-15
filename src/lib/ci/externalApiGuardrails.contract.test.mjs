import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const youtube = await readFile(
  new URL("../../../workers/youtube-sync/index.ts", import.meta.url),
  "utf8",
);
const youtubeQuota = await readFile(
  new URL("../../../workers/youtube-sync/quotaBudget.ts", import.meta.url),
  "utf8",
);
const youtubeQuotaPolicy = await readFile(
  new URL("../youtube/quotaPolicy.ts", import.meta.url),
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
  assert.match(youtube, /YOUTUBE_MAX_EXTERNAL_REQUESTS_PER_RUN/);
  assert.match(
    youtube,
    /reserveYoutubeQuota\(\s*env,\s*plannedQuotaUnits,\s*now,\s*signal,\s*\)/,
  );
  assert.match(youtubeQuota, /external_api_quota_usage/);
  assert.match(youtubeQuotaPolicy, /YOUTUBE_TARGET_USAGE_PERCENT = 80/);
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
  // The image proxy has one bounded stream-reader loop. It exits on EOF or
  // cancels as soon as maxObjectBytes is exceeded; do not classify that body
  // reader as a provider retry loop.
  const imageProxyWithoutBoundedReader = imageProxy.replace(
    /async function readBodyUpToLimit\([\s\S]*?\n}\r?\n\r?\nasync function fetchWithTimeout/,
    "async function fetchWithTimeout",
  );
  assert.doesNotMatch(imageProxyWithoutBoundedReader, /while \(true\)/);
  assert.match(imageProxy, /readBodyUpToLimit/);
  assert.match(youtube, /YOUTUBE_SYNC_MAX_ATTEMPTS = 2/);
});

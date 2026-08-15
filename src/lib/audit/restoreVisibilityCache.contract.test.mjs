import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./restore.ts", import.meta.url)),
  "utf8",
);

test("audit video restore invalidates the same global projections as visibility actions", () => {
  assert.match(source, /RANDOM_VIDEO_POOL_OBJECT_KEY/);
  assert.match(source, /YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY/);
  assert.match(source, /TOP_RECOMMENDED_OBJECT_KEY/);
  assert.match(source, /TOP_LATEST_OBJECT_KEY/);
  assert.match(source, /TOP_NOSTALGIC_OBJECT_KEY/);
  assert.match(source, /TOP_STATS_OBJECT_KEY/);
  assert.match(source, /list\/recent\.json/);
  assert.match(source, /list\/popular\.json/);
  assert.match(source, /search-index-lite\.json/);
  assert.match(source, /top\.json/);
});

test("audit video restore invalidates both primary event and all user profile pages", () => {
  assert.match(source, /current\?\.primary_event_id/);
  assert.match(source, /target\.primary_event_id/);
  assert.match(source, /STATIC_USER_MAX_PAGES/);
  assert.match(source, /users\/\$\{xUserId\}\/works\/\$\{page\}\.json/);
  assert.match(source, /users\/\$\{xUserId\}\/collabs\/\$\{page\}\.json/);
  assert.match(source, /current\?\.youtube_video_id/);
  assert.match(source, /target\.youtube_video_id/);
});

test("audit event restore invalidates global event projections", () => {
  assert.match(source, /events\/index\.json/);
  assert.match(source, /top\/sections\/events\.v1\.json/);
  assert.match(source, /eventComposedObjectKey\(log\.target_id\)/);
});

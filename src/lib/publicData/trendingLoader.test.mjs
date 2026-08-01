import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const loaderSource = fs.readFileSync(
  path.join(root, "src/lib/publicData/trendingLoader.ts"),
  "utf8",
);
const coreSource = fs.readFileSync(
  path.join(root, "src/lib/publicData/staticTrendingCore.ts"),
  "utf8",
);

test("trendingLoader: D1 / static_rebuild_queue を参照しない", () => {
  assert.doesNotMatch(loaderSource, /getDatabase/);
  assert.doesNotMatch(loaderSource, /static_rebuild_queue/);
  assert.doesNotMatch(loaderSource, /loadPublicJson/);
  assert.doesNotMatch(loaderSource, /resolvePublicOperationMode/);
});

test("trendingLoader: R2 analytics/trending.json のみを読む", () => {
  assert.match(loaderSource, /analytics\/trending\.json/);
  assert.match(loaderSource, /getEnv\(\)\.BUCKET/);
  assert.match(loaderSource, /bucket\.get/);
  assert.match(loaderSource, /normalizeStaticTrending/);
  assert.match(loaderSource, /resolveStaticTrendingStaleMeta/);
});

test("trendingLoader: miss 時は data null を返す契約", () => {
  assert.match(loaderSource, /data,\s*\.\.\.staleMeta/);
  assert.match(loaderSource, /return null/);
});

test("staticTrendingCore: stale 閾値が 3h / 24h", () => {
  assert.match(coreSource, /3 \* 60 \* 60/);
  assert.match(coreSource, /24 \* 60 \* 60/);
  assert.match(coreSource, /tooOldForHome/);
});

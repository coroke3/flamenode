import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [
  middlewareSource,
  reuseSource,
  trendingSource,
  aboutStatsSource,
  staffSource,
  suggestionsSource,
  suggestionsV2Source,
  visibilityManifestSource,
  pickupCreatorsSource,
  publicCacheSource,
  scoreThrottleSource,
] = await Promise.all([
  read("middleware.ts"),
  read("src/lib/event/eventIdReuse.ts"),
  read("src/lib/publicData/trendingLoader.ts"),
  read("app/api/public/about-stats/route.ts"),
  read("app/api/public/events/[id]/staff/route.ts"),
  read("src/lib/video/memberSuggestionsLoader.ts"),
  read("src/lib/video/memberSuggestionsV2Loader.ts"),
  read("src/lib/publicData/publicVisibilityManifest.ts"),
  read("workers/json-generator/pickupCreatorsR2.ts"),
  read("src/lib/publicData/publicCache.ts"),
  read("workers/sync-jobs/scoreRankingRebuildThrottle.ts"),
]);

test("middlewareはrequest context由来Promiseをisolate globalへ保持しない", () => {
  assert.doesNotMatch(middlewareSource, /configuredSiteOriginPromise/);
  assert.match(middlewareSource, /let configuredSiteOrigin: string \| undefined/);
});

test("event ID再利用のR2存在確認はGETではなくHEADを使う", () => {
  assert.match(reuseSource, /\.map\(\(key\) => bucket\.head\(key\)\)/);
  assert.doesNotMatch(reuseSource, /\.map\(\(key\) => bucket\.get\(key\)\)/);
});

test("trending artifactはJSON parse前にbyte上限を検査する", () => {
  assert.match(trendingSource, /TRENDING_MAX_OBJECT_BYTES/);
  assert.match(trendingSource, /object\.size > TRENDING_MAX_OBJECT_BYTES/);
  assert.match(trendingSource, /cancelR2BodyBestEffort\(object\)/);
  assert.ok(
    trendingSource.indexOf("object.size > TRENDING_MAX_OBJECT_BYTES") <
      trendingSource.indexOf("object.json()"),
  );
});

test("oversize R2 early returnはpublic/media/autocompleteでbodyを解放する", () => {
  assert.match(aboutStatsSource, /cancelR2BodyBestEffort\(object\)/);
  assert.match(staffSource, /cancelR2BodyBestEffort\(object\)/);
  assert.match(suggestionsSource, /cancelR2BodyBestEffort\(manifestObject\)/);
  assert.match(suggestionsSource, /cancelR2BodyBestEffort\(indexObject\)/);
  assert.match(suggestionsV2Source, /cancelR2BodyBestEffort\(object\)/);
});

test("visibility manifestは既知R2 sizeなら本文を再encodeしない", () => {
  assert.match(visibilityManifestSource, /const hasKnownSize = typeof object\.size === "number"/);
  assert.match(visibilityManifestSource, /!hasKnownSize && utf8ByteLength\(text\)/);
  assert.match(visibilityManifestSource, /cancelR2BodyBestEffort\(object\)/);
});

test("pickup creators workerは既存1MiB上限をparse前に適用する", () => {
  assert.match(pickupCreatorsSource, /PICKUP_CREATORS_MAX_OBJECT_BYTES/);
  assert.match(pickupCreatorsSource, /object\.size > PICKUP_CREATORS_MAX_OBJECT_BYTES/);
  assert.match(pickupCreatorsSource, /cancelR2BodyBestEffort\(object\)/);
  assert.ok(
    pickupCreatorsSource.indexOf("object.size > PICKUP_CREATORS_MAX_OBJECT_BYTES") <
      pickupCreatorsSource.indexOf("object.json()"),
  );
});

test("public Cache APIは巨大JSONを全bufferせずread/write両側でbyte上限を持つ", () => {
  assert.match(publicCacheSource, /PUBLIC_JSON_CACHE_MAX_BYTES/);
  assert.match(publicCacheSource, /contentLengthBytes\(response\)/);
  assert.match(publicCacheSource, /const reader = body\.getReader\(\)/);
  assert.match(publicCacheSource, /if \(total > maxBytes\)/);
  assert.match(publicCacheSource, /reader\.cancel\(\)/);
  assert.match(publicCacheSource, /utf8ByteLengthExceeds\(serialized, PUBLIC_JSON_CACHE_MAX_BYTES\)/);
  assert.doesNotMatch(publicCacheSource, /await matched\.json\(\)/);
  assert.doesNotMatch(publicCacheSource, /response\.arrayBuffer\(\)/);
});

test("score rankingのevents indexはbounded readし、abortをfallbackへ握り潰さない", () => {
  assert.match(scoreThrottleSource, /EVENTS_INDEX_MAX_OBJECT_BYTES/);
  assert.match(scoreThrottleSource, /object\.size > EVENTS_INDEX_MAX_OBJECT_BYTES/);
  assert.match(scoreThrottleSource, /cancelR2BodyBestEffort\(object\)/);
  assert.ok(
    scoreThrottleSource.indexOf("object.size > EVENTS_INDEX_MAX_OBJECT_BYTES") <
      scoreThrottleSource.indexOf("object.json()"),
  );
  assert.ok(scoreThrottleSource.split("signal?.throwIfAborted();").length - 1 >= 9);
});

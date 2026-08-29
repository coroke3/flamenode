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
  usersIndexV2ArtifactsSource,
  artifactSloSource,
  deepHealthSource,
  gaTrendingSyncSource,
  publicLoaderSource,
  optimizedRebuildSource,
  publicIconV2ArtifactsSource,
  memberSuggestionsArtifactsSource,
  memberSuggestionsV2ArtifactsSource,
  legacyPreviewStoreSource,
  videoDetailQueriesSource,
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
  read("workers/json-generator/usersIndexV2Artifacts.ts"),
  read("src/lib/health/artifactSlo.ts"),
  read("src/lib/health/deepHealth.ts"),
  read("workers/ga-analytics/sync.ts"),
  read("src/lib/publicData/loader.ts"),
  read("workers/json-generator/optimizedRebuild.ts"),
  read("workers/json-generator/publicIconV2Artifacts.ts"),
  read("workers/json-generator/memberSuggestionsArtifacts.ts"),
  read("workers/json-generator/memberSuggestionsV2Artifacts.ts"),
  read(["src", "lib", "import", "legacy", "previewStore.ts"].join("/")),
  read("src/lib/db/videoDetailQueries.ts"),
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
  assert.match(
    trendingSource,
    /maxObjectBytes:\s*TRENDING_MAX_OBJECT_BYTES/,
  );
  assert.match(trendingSource, /loadStaticJsonFreshStaleUnavailable/);
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

test("users index v2 workerはmanifest/legacy正本をbounded readする", () => {
  assert.match(usersIndexV2ArtifactsSource, /USERS_INDEX_V2_MAX_MANIFEST_BYTES/);
  assert.match(usersIndexV2ArtifactsSource, /USERS_INDEX_MAX_OBJECT_BYTES/);
  assert.match(usersIndexV2ArtifactsSource, /cancelR2BodyBestEffort/);
  const manifestSize = usersIndexV2ArtifactsSource.indexOf(
    "object.size > USERS_INDEX_V2_MAX_MANIFEST_BYTES",
  );
  const manifestParse = usersIndexV2ArtifactsSource.indexOf(
    "object.json<unknown>()",
    manifestSize,
  );
  assert.ok(manifestSize >= 0 && manifestParse > manifestSize);
  const legacySize = usersIndexV2ArtifactsSource.indexOf(
    "object.size > USERS_INDEX_MAX_OBJECT_BYTES",
  );
  const legacyParse = usersIndexV2ArtifactsSource.indexOf("object.json()", legacySize);
  assert.ok(legacySize >= 0 && legacyParse > legacySize);
});

test("health diagnosticsはoversize artifactを本文parse前に拒否してbodyを解放する", () => {
  assert.match(artifactSloSource, /ARTIFACT_SLO_MAX_OBJECT_BYTES = 16 \* 1024 \* 1024/);
  assert.match(artifactSloSource, /object\.size > ARTIFACT_SLO_MAX_OBJECT_BYTES/);
  assert.match(artifactSloSource, /cancelR2BodyBestEffort\(object\)/);
  assert.ok(
    artifactSloSource.indexOf("object.size > ARTIFACT_SLO_MAX_OBJECT_BYTES") <
      artifactSloSource.indexOf("JSON.parse(await object.text())"),
  );
  assert.match(deepHealthSource, /PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES/);
  assert.match(deepHealthSource, /object\.size > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES/);
  assert.match(deepHealthSource, /reportDegraded\("manifest_too_large"\)/);
  assert.match(deepHealthSource, /cancelR2BodyBestEffort\(object\)/);
});

test("GA trending syncはrecent/existing trendingをbounded readしabort時にbodyを解放する", () => {
  assert.match(gaTrendingSyncSource, /GA4_RECENT_LIST_MAX_OBJECT_BYTES = 8 \* 1024 \* 1024/);
  assert.match(gaTrendingSyncSource, /GA4_TRENDING_MAX_OBJECT_BYTES = 1024 \* 1024/);
  assert.match(gaTrendingSyncSource, /cancelR2BodyBestEffort\(object\)/);
  assert.match(gaTrendingSyncSource, /ga4_recent_list_too_large/);
  const recentGuard = gaTrendingSyncSource.indexOf(
    "isOversizedR2Object(object, GA4_RECENT_LIST_MAX_OBJECT_BYTES)",
  );
  const recentRead = gaTrendingSyncSource.indexOf("const text = await object.text()", recentGuard);
  assert.ok(recentGuard >= 0 && recentRead > recentGuard);
  assert.match(
    gaTrendingSyncSource,
    /if \(signal\?\.aborted\) \{\s*await cancelR2BodyBestEffort\(object\);\s*signal\.throwIfAborted\(\);/,
  );
});

test("public共通loaderはR2 JSONを16MiBでbounded readする", () => {
  assert.match(
    publicLoaderSource,
    /PUBLIC_STATIC_JSON_MAX_OBJECT_BYTES = 16 \* 1024 \* 1024/,
  );
  assert.match(
    publicLoaderSource,
    /object\.size > PUBLIC_STATIC_JSON_MAX_OBJECT_BYTES/,
  );
  assert.match(publicLoaderSource, /cancelR2BodyBestEffort\(object\)/);
  assert.match(publicLoaderSource, /"object_too_large"/);
  const guard = publicLoaderSource.indexOf(
    "object.size > PUBLIC_STATIC_JSON_MAX_OBJECT_BYTES",
  );
  const parse = publicLoaderSource.indexOf("object.json()", guard);
  assert.ok(guard >= 0 && parse > guard);
});

test("legacy rebuildは共通R2 wrapperでoversizeとGET直後abortを遮断する", () => {
  assert.match(
    optimizedRebuildSource,
    /LEGACY_REBUILD_R2_MAX_OBJECT_BYTES = 16 \* 1024 \* 1024/,
  );
  assert.match(optimizedRebuildSource, /function withBoundedAbortSafeR2/);
  assert.match(
    optimizedRebuildSource,
    /object\.size > LEGACY_REBUILD_R2_MAX_OBJECT_BYTES/,
  );
  assert.match(
    optimizedRebuildSource,
    /if \(signal\?\.aborted\) \{\s*await cancelR2BodyBestEffort\(object\);\s*throwIfAborted\(signal\);/,
  );
  assert.match(
    optimizedRebuildSource,
    /const legacyEnv = withBoundedAbortSafeR2\(env, signal\);/,
  );
  assert.match(
    optimizedRebuildSource,
    /rebuildTarget\(\s*legacyEnv,/,
  );
  assert.match(
    optimizedRebuildSource,
    /UPDATE static_artifacts\s+SET deleted_at = \?/,
  );
});

test("public icon v2 rebuildはR2 GET/HEAD境界でabortを継続処理へ変換しない", () => {
  assert.match(publicIconV2ArtifactsSource, /cancelObjectBodyBestEffort\(legacyObject\)/);
  assert.match(
    publicIconV2ArtifactsSource,
    /const object = await env\.R2\.head[\s\S]*?throwIfAborted\(signal\);/,
  );
  assert.match(
    publicIconV2ArtifactsSource,
    /catch \{\s*throwIfAborted\(signal\);\s*return false;/,
  );
});

test("member suggestions V1/V2 manifest readはsize guardとabort cleanupを持つ", () => {
  assert.match(
    memberSuggestionsArtifactsSource,
    /object\.size > MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES/,
  );
  assert.match(
    memberSuggestionsArtifactsSource,
    /await cancelR2BodyBestEffort\(object\)/,
  );
  assert.match(
    memberSuggestionsV2ArtifactsSource,
    /object\.size > MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES/,
  );
  assert.match(
    memberSuggestionsV2ArtifactsSource,
    /readPreviousGeneration\(bucket, signal\)/,
  );
  assert.match(
    memberSuggestionsV2ArtifactsSource,
    /catch \{\s*throwIfAborted\(signal\);\s*return null;/,
  );
});

test("legacy import previewはwriterと同じ512KiB上限をreaderにも適用する", () => {
  assert.match(legacyPreviewStoreSource, /MAX_STORED_PLAN_BYTES = 512 \* 1024/);
  assert.match(
    legacyPreviewStoreSource,
    /object\.size > MAX_STORED_PLAN_BYTES/,
  );
  assert.match(legacyPreviewStoreSource, /cancelR2BodyBestEffort\(object\)/);
  const helper = legacyPreviewStoreSource.indexOf("async function readStoredPreviewObject");
  const guard = legacyPreviewStoreSource.indexOf(
    "object.size > MAX_STORED_PLAN_BYTES",
    helper,
  );
  const read = legacyPreviewStoreSource.indexOf("object.text()", helper);
  assert.ok(helper >= 0 && guard > helper && read > guard);
  assert.ok(
    legacyPreviewStoreSource.split("readStoredPreviewObject(").length - 1 >= 3,
  );
});

test("event playlistのoversize R2はD1 fallback前にbodyを解放する", () => {
  const guard = videoDetailQueriesSource.indexOf(
    "object.size > EVENT_PLAYLIST_MAX_OBJECT_BYTES",
  );
  const cancel = videoDetailQueriesSource.indexOf(
    "await cancelR2BodyBestEffort(object)",
    guard,
  );
  const clear = videoDetailQueriesSource.indexOf("object = null", guard);
  assert.ok(guard >= 0 && cancel > guard && clear > cancel);
});

/**
 * operation_mode 別の公開 JSON ローダー挙動。
 *
 * Usage: node --test src/lib/publicData/loader.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canFallbackToDatabase,
  isMaintenanceStrategy,
  shouldUseStaticCollection,
} from "./loaderPolicy.ts";

const loaderSource = await readFile(new URL("./loader.ts", import.meta.url), "utf8");

test("canFallbackToDatabase: overlay のみ DB fallback 可", () => {
  assert.equal(canFallbackToDatabase("static_json_with_live_overlay"), true);
  assert.equal(canFallbackToDatabase("static_json_only"), false);
  assert.equal(canFallbackToDatabase("maintenance"), false);
});

test("isMaintenanceStrategy", () => {
  assert.equal(isMaintenanceStrategy("maintenance"), true);
  assert.equal(isMaintenanceStrategy("static_json_only"), false);
});

test("overlay treats an empty static collection as a DB fallback miss", () => {
  assert.equal(
    shouldUseStaticCollection("static_json_with_live_overlay", 0),
    false,
  );
  assert.equal(
    shouldUseStaticCollection("static_json_with_live_overlay", 1),
    true,
  );
  assert.equal(shouldUseStaticCollection("static_json_only", 0), true);
  assert.equal(shouldUseStaticCollection("maintenance", 0), true);
});

test("loader exposes paginated user profile loaders", () => {
  assert.match(loaderSource, /loadStaticUserWorksPage/);
  assert.match(loaderSource, /loadStaticUserCollabsPage/);
  assert.match(loaderSource, /users\/\$\{params\.userId\}\/works\//);
});

test("loader は Cache → R2 → degraded の順で公開 JSON を解決する", () => {
  const loadPublicJsonFn = loaderSource.slice(
    loaderSource.indexOf("export async function loadPublicJson"),
  );
  assert.match(loadPublicJsonFn, /resolvePublicOperationMode\(\{ allowD1: true \}\)/);
  assert.match(loadPublicJsonFn, /maintenanceStrategy === "maintenance"/);
  assert.match(loadPublicJsonFn, /unwrapPublicJsonCachePayload/);
  assert.match(loadPublicJsonFn, /readPublicJsonCache/);
  const r2Index = loadPublicJsonFn.indexOf("readStaticJson");
  const missIndex = loadPublicJsonFn.lastIndexOf("return resolvePublicJsonMiss");
  assert.ok(r2Index >= 0 && missIndex > r2Index, "R2 read precedes miss");
  assert.ok(r2Index >= 0 && missIndex > r2Index, "R2 read precedes miss");
  assert.match(loaderSource, /async function resolvePublicJsonMiss/);
  assert.match(
    loaderSource,
    /resolvePublicOperationMode\(\{ allowD1: true/,
  );
  assert.match(loaderSource, /degradedFetcher/);
  assert.doesNotMatch(loaderSource, /getOperationMode/);
  assert.match(loaderSource, /resolvePublicMissEnqueuePriority/);
});

test("loader の R2 ヒット分岐は getDatabase を呼ばない", () => {
  const loadPublicJsonFn = loaderSource.slice(
    loaderSource.indexOf("export async function loadPublicJson"),
    loaderSource.indexOf("export const loadStaticEventDetail"),
  );
  const hitBranch = loadPublicJsonFn.slice(
    loadPublicJsonFn.indexOf("if (payload !== null)"),
    loadPublicJsonFn.indexOf("return resolvePublicJsonMiss"),
  );
  assert.doesNotMatch(hitBranch, /getDatabase\(/);
  assert.doesNotMatch(hitBranch, /systemSettings/);
  assert.doesNotMatch(hitBranch, /directEnqueueStaticRebuild/);
});

test("loader records public request metrics hooks", () => {
  assert.match(loaderSource, /recordPublicStaticHit/);
  assert.match(loaderSource, /recordPublicStaticMiss/);
  assert.match(loaderSource, /recordPublicR2Get/);
  assert.match(loaderSource, /recordPublicD1Query/);
});

test("createPublicJsonLoader treats normalize failure as semantic miss without double miss", () => {
  assert.match(loaderSource, /async function resolvePublicJsonMiss/);
  assert.match(
    loaderSource,
    /const normalized = normalize\(result\.data\);[\s\S]*skipStaticMissRecord: true/,
  );
});

test("loadPublicJson applies empty collection semantic miss on cache and R2 hits", () => {
  assert.match(loaderSource, /isEmptyCollection/);
  assert.match(
    loaderSource,
    /if \(options\.isEmptyCollection\?\.\(cached\)\)/,
  );
  assert.match(
    loaderSource,
    /if \(options\.isEmptyCollection\?\.\(payload\)\)/,
  );
});

test("events index, top, and recommend loaders wire empty collection semantic miss", () => {
  const eventsIndexBlock = loaderSource.slice(
    loaderSource.indexOf("export async function loadStaticEventsIndex"),
    loaderSource.indexOf("export async function loadStaticRecentVideosPage"),
  );
  assert.match(eventsIndexBlock, /isEmptyCollection: isEmptyItemsCollection/);

  const topBlock = loaderSource.slice(
    loaderSource.indexOf("export async function loadStaticTopPage"),
    loaderSource.indexOf("export async function loadStaticUsersIndex"),
  );
  assert.match(topBlock, /isEmptyCollection: isEmptyTopCollection/);
  assert.match(topBlock, /TOP_SLOT_STATS_OBJECT_KEY/);
  assert.match(topBlock, /applyTopSlotStatsOverride/);
  assert.match(topBlock, /shouldUseStaticCollection/);

  const recommendBlock = loaderSource.slice(
    loaderSource.indexOf("export async function loadStaticRecommendPage"),
    loaderSource.indexOf("export const loadStaticUserProfile"),
  );
  assert.match(recommendBlock, /isEmptyCollection: isEmptyRecommendCollection/);
});

test("popular list loader wires degraded fallback", () => {
  assert.match(loaderSource, /fetchDegradedPopularListPayload/);
});

test("list loaders support old sort via recent payload ordering", () => {
  assert.match(loaderSource, /sortRecentPayloadForList/);
  assert.match(loaderSource, /sort\?: "new" \| "old" \| "score"/);
});

test("resolvePublicJsonMiss は公開 miss を high 優先度で enqueue する", () => {
  assert.match(loaderSource, /PUBLIC_MISS_HIGH_PRIORITY_TARGET_TYPES/);
  assert.match(loaderSource, /resolvePublicMissEnqueuePriority/);
  assert.match(loaderSource, /"user"/);
  assert.match(loaderSource, /"users_index"/);
  assert.match(loaderSource, /"list_recent"/);
  assert.match(loaderSource, /"list_popular"/);
  assert.match(loaderSource, /"search_index"/);
  assert.match(
    loaderSource,
    /const enqueueResult = await directEnqueueStaticRebuild/,
  );
});

test("degraded user profile は works/collabs の total を COUNT で返す", async () => {
  const degradedSource = await readFile(
    new URL("./degradedQueries.ts", import.meta.url),
    "utf8",
  );
  const profileFn = degradedSource.slice(
    degradedSource.indexOf("export async function fetchDegradedUserProfilePayload"),
    degradedSource.indexOf("export async function fetchDegradedRulesPayload"),
  );
  assert.match(profileFn, /count\(\*\)/);
  assert.match(profileFn, /DEGRADED_USER_COLLABS_LIMIT/);
  assert.match(profileFn, /collabMemberExists/);
  assert.doesNotMatch(profileFn, /total: 0,\s*\n\s*items: \[\]/);
});

test("list loaders use static pool size for shouldUseStaticCollection", () => {
  const recentBlock = loaderSource.slice(
    loaderSource.indexOf("export async function loadStaticRecentVideosPage"),
    loaderSource.indexOf("export async function loadStaticPopularVideosPage"),
  );
  assert.match(recentBlock, /const poolSize = Array\.isArray\(result\.data\?\.items\)/);
  assert.match(recentBlock, /shouldUseStaticCollection\(result\.strategy, poolSize\)/);
  assert.doesNotMatch(
    recentBlock,
    /shouldUseStaticCollection\(result\.strategy, normalizedPage\?\.videos\.length/,
  );
  assert.doesNotMatch(recentBlock, /const itemCount = normalizedPage\?\.videos\.length/);

  const popularBlock = loaderSource.slice(
    loaderSource.indexOf("export async function loadStaticPopularVideosPage"),
    loaderSource.indexOf("export async function loadStaticSearchVideosPage"),
  );
  assert.match(popularBlock, /const poolSize = Array\.isArray\(result\.data\?\.items\)/);
  assert.match(popularBlock, /shouldUseStaticCollection\(result\.strategy, poolSize\)/);

  const searchBlock = loaderSource.slice(
    loaderSource.indexOf("export async function loadStaticSearchVideosPage"),
    loaderSource.indexOf("export async function loadPublicEventVideosPage"),
  );
  assert.match(searchBlock, /const poolSize = Array\.isArray\(payload\?\.videos\)/);
  assert.match(searchBlock, /shouldUseStaticCollection\(result\.strategy, poolSize\)/);
  assert.doesNotMatch(searchBlock, /const itemCount = normalizedPage\?\.videos\.length/);
});

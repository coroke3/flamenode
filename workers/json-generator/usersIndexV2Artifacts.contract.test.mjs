import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./usersIndexV2Artifacts.ts", import.meta.url),
  "utf8",
);
const optimizedSource = await readFile(
  new URL("./optimizedRebuild.ts", import.meta.url),
  "utf8",
);
const loaderSource = await readFile(
  new URL("../../src/lib/publicData/staticUsersIndexV2Loader.ts", import.meta.url),
  "utf8",
);

test("users index v2 はgeneration固有page/search完了後にmanifestをcommit pointとして書く", () => {
  const pagePut = source.indexOf("await putTrackedJson(env, entry.key, entry.page, signal)");
  const searchPut = source.indexOf("await putTrackedJson(env, searchKey, artifacts.searchLite, signal)");
  const manifestPut = source.indexOf("USERS_INDEX_V2_MANIFEST_OBJECT_KEY,\n    artifacts.manifest");
  const reconcile = source.indexOf("await reconcileTrackedArtifacts(env, liveKeys, signal)");

  assert.ok(pagePut >= 0);
  assert.ok(searchPut > pagePut);
  assert.ok(manifestPut > searchPut);
  assert.ok(reconcile > manifestPut);
  assert.match(source, /usersIndexV2ScorePageObjectKey\(generation, page\.page\)/);
  assert.match(source, /usersIndexV2SearchLiteObjectKey\(generation\)/);
  assert.match(loaderSource, /search\.generation !== manifest\.generation/);
  assert.match(loaderSource, /page\.generation !== manifest\.generation/);
  assert.match(loaderSource, /hasEnforcedXUserVisibilityFence/);
});

test("全size guardをR2 PUT前に評価する", () => {
  const firstSizeGuard = source.indexOf("for (const entry of scoreEntries)");
  const firstPut = source.indexOf("await putTrackedJson(env, entry.key, entry.page, signal)");
  assert.ok(firstSizeGuard >= 0);
  assert.ok(firstPut > firstSizeGuard);
  assert.match(source, /USERS_SEARCH_LITE_V1_MAX_BYTES/);
  assert.match(source, /USERS_INDEX_V2_MAX_MANIFEST_BYTES/);
});

test("users_index canonical rebuild 後にv2生成を必ず実行する", () => {
  assert.match(
    optimizedSource,
    /targetType === "users_index"[\s\S]*rebuildUsersIndexV2FromLegacyArtifact/,
  );
});

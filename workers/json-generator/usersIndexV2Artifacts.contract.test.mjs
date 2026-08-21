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

test("users index v2 は generation 固有 page/search 完了後に manifest をcommit pointとして書く", () => {
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
});

test("v2生成失敗はmanifest無効化に成功した場合だけlegacy fallback成功扱いにする", () => {
  assert.match(source, /invalidateUsersIndexV2Manifest/);
  assert.match(source, /env\.R2\.delete\(USERS_INDEX_V2_MANIFEST_OBJECT_KEY\)/);
  assert.match(source, /result: "legacy_fallback"/);
  assert.match(source, /result: "manifest_invalidation_failed"/);
  assert.match(source, /throw error/);
});

test("users_index canonical rebuild 後にv2生成を必ず実行する", () => {
  assert.match(
    optimizedSource,
    /targetType === "users_index"[\s\S]*rebuildUsersIndexV2FromLegacyArtifact/,
  );
});

test("v2 manifest はR2正本で読みstale Cache APIへ戻さない", () => {
  const manifestLoad = loaderSource.match(
    /r2Key: USERS_INDEX_V2_MANIFEST_OBJECT_KEY,[\s\S]*?\n  \}\);/,
  );
  assert.ok(manifestLoad);
  assert.match(manifestLoad[0], /cacheMode: "r2_first"/);
  assert.match(manifestLoad[0], /allowStaleCacheFallback: false/);
});

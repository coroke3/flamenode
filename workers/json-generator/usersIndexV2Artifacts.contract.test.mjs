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
const pageSource = await readFile(
  new URL("../../app/(public)/user/page.tsx", import.meta.url),
  "utf8",
);

test("users index v2 は3 sortのgeneration固有page/search完了後にmanifestをcommitする", () => {
  const pagePut = source.indexOf("await putTrackedJson(env, entry.key, entry.page, signal)");
  const searchPut = source.indexOf("await putTrackedJson(env, searchKey, artifacts.searchLite, signal)");
  const manifestPut = source.indexOf("USERS_INDEX_V2_MANIFEST_OBJECT_KEY,\n    artifacts.manifest");
  const reconcile = source.indexOf("await reconcileTrackedArtifacts(env, liveKeys, signal)");

  assert.ok(pagePut >= 0);
  assert.ok(searchPut > pagePut);
  assert.ok(manifestPut > searchPut);
  assert.ok(reconcile > manifestPut);
  assert.match(source, /artifacts\.scorePages/);
  assert.match(source, /artifacts\.worksPages/);
  assert.match(source, /artifacts\.namePages/);
  assert.match(source, /usersIndexV2PageObjectKey\(generation, page\.sort, page\.page\)/);
  assert.match(source, /usersIndexV2SearchLiteObjectKey\(generation\)/);
  assert.match(loaderSource, /page\.generation !== manifest\.generation/);
  assert.match(loaderSource, /page\.sort !== params\.sort/);
  assert.match(pageSource, /loadStaticUsersIndexV2Page/);
});

test("generation hash はcontentだけでなくlayout versionも含める", () => {
  assert.match(source, /USERS_INDEX_V2_GENERATION_LAYOUT_VERSION/);
  assert.match(source, /layout_version: USERS_INDEX_V2_GENERATION_LAYOUT_VERSION/);
});

test("stale generation cleanup はR2 bulk deleteとD1単一UPDATEへまとめる", () => {
  assert.match(source, /await env\.R2\.delete\(staleKeys\)/);
  assert.match(source, /FROM json_each\(\?\) AS stale_keys/);
  assert.match(source, /JSON\.stringify\(staleKeys\)/);
  assert.doesNotMatch(source, /for \(const row of staleRows\)[\s\S]*env\.R2\.delete/);
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

test("v2 miss はD1 probe/enqueueへ進まず任意static artifactとしてfail-fastする", () => {
  assert.match(loaderSource, /loadStaticJsonFreshStaleUnavailable/);
  assert.doesNotMatch(loaderSource, /loadPublicJson/);
  assert.doesNotMatch(loaderSource, /targetType:\s*"users_index"/);
  const manifestLoad = loaderSource.match(
    /key: USERS_INDEX_V2_MANIFEST_OBJECT_KEY,[\s\S]*?cacheMode: "bypass"/,
  );
  assert.ok(manifestLoad);
});

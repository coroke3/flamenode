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

test("users index v2 は page/search 完了後に manifest をcommit pointとして書く", () => {
  const pagePut = source.indexOf("await putTrackedJson(env, key, page, signal)");
  const searchPut = source.indexOf("USERS_SEARCH_LITE_V1_OBJECT_KEY,\n    artifacts.searchLite");
  const manifestPut = source.indexOf("USERS_INDEX_V2_MANIFEST_OBJECT_KEY,\n    artifacts.manifest");
  const reconcile = source.indexOf("await reconcileTrackedArtifacts(env, liveKeys, signal)");

  assert.ok(pagePut >= 0);
  assert.ok(searchPut > pagePut);
  assert.ok(manifestPut > searchPut);
  assert.ok(reconcile > manifestPut);
  assert.match(loaderSource, /search\.generation !== manifest\.generation/);
  assert.match(loaderSource, /page\.generation !== manifest\.generation/);
});

test("users_index canonical rebuild 後にv2生成を必ず実行する", () => {
  assert.match(
    optimizedSource,
    /targetType === "users_index"[\s\S]*rebuildUsersIndexV2FromLegacyArtifact/,
  );
});

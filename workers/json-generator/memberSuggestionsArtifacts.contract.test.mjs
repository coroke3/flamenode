import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./memberSuggestionsArtifacts.ts", import.meta.url),
  "utf8",
);

test("member suggestions rollbackはgeneration-specific indexを削除しない", () => {
  assert.match(
    source,
    /cleanupWrittenArtifacts\(env, committed, new Set\(\[indexKey\]\)\)/,
  );
  assert.match(
    source,
    /artifact\.wrote && !preserveObjectKeys\.has\(artifact\.objectKey\)/,
  );
});

test("member suggestionsはmanifestをindex書込前に退避する", () => {
  const previousManifestRead = source.indexOf(
    "previousManifest = await readPreviousManifest(env, signal)",
  );
  const indexPut = source.indexOf(
    "const indexArtifact = await putTrackedJson(env, indexKey, index, signal",
  );
  assert.ok(previousManifestRead >= 0);
  assert.ok(indexPut > previousManifestRead);
});

test("source row上限は許容最大+1件をsentinelとして読む", () => {
  assert.match(source, /SOURCE_LIMIT_X_USERS = 20_001/);
  assert.match(source, /SOURCE_LIMIT_ALIASES = 50_001/);
  assert.match(source, /SOURCE_LIMIT_VIDEO_HISTORY = 20_001/);
  assert.match(source, /profileRows\.length >= SOURCE_LIMIT_X_USERS/);
  assert.match(source, /aliasRows\.length >= SOURCE_LIMIT_ALIASES/);
  assert.match(source, /creatorRows\.length >= SOURCE_LIMIT_VIDEO_HISTORY/);
  assert.match(source, /memberRows\.length >= SOURCE_LIMIT_VIDEO_HISTORY/);
});

test("rollback用の旧manifestもsize上限を超えたらbodyを読まない", () => {
  const sizeGuard = source.indexOf(
    'object.size > MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES',
  );
  const textRead = source.indexOf('const body = await object.text()', sizeGuard);
  assert.ok(sizeGuard >= 0 && textRead > sizeGuard);
});

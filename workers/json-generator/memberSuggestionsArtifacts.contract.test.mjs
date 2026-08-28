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

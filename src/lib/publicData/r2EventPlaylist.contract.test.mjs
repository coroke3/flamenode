import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./r2EventPlaylist.ts", import.meta.url),
  "utf8",
);

test("event playlist R2 readerはvisibility manifestをenforce時だけ読む", () => {
  assert.match(
    source,
    /const visibility =\s*guardMode === "enforce"\s*\? await readPublicVisibilityBlockedEntitiesManifest/s,
  );

  const artifactRead = source.indexOf(
    "const object = await bucket.get(args.objectKey(normalizedId));",
  );
  assert.ok(artifactRead >= 0);
  const postGuard = source.indexOf(
    'if (guardMode === "enforce") {',
    artifactRead,
  );
  assert.ok(postGuard > artifactRead);
  assert.match(
    source.slice(postGuard),
    /const afterVisibility = await readPublicVisibilityBlockedEntitiesManifest/,
  );
});

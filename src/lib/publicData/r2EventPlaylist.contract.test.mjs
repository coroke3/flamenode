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

test("oversized R2 event artifactはJSON parse前にbodyをcancelしてfail-closedする", () => {
  const sizeGuard = source.indexOf("object.size > args.maxBytes");
  const cancel = source.indexOf("await cancelR2BodyBestEffort", sizeGuard);
  const parse = source.indexOf("await object.json<unknown>()", sizeGuard);
  assert.ok(sizeGuard >= 0 && cancel > sizeGuard && parse > cancel);
  assert.match(source, /await object\.body\.cancel\(\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../../app/api/youtube-thumbnail/[id]/[size]/route.ts", import.meta.url),
  "utf8",
);

test("YouTube thumbnail routeは共通proxyと2MB上限を利用する", () => {
  assert.match(source, /proxyExternalImage/);
  assert.match(source, /namespace: "youtube-thumbnail"/);
  assert.match(source, /MAX_OBJECT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(source, /i\.ytimg\.com\/vi/);
  assert.match(source, /decodeURIComponent/);
  assert.doesNotMatch(source, /getDatabase/);
});

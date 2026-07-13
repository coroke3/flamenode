import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const routeSource = await readFile(
  new URL("../../../app/api/google-drive-image/[id]/route.ts", import.meta.url),
  "utf8",
);
const helperSource = await readFile(
  new URL("./externalImageProxy.ts", import.meta.url),
  "utf8",
);

test("Google Drive画像routeは共通proxyと単一画像上限を利用する", () => {
  assert.match(routeSource, /proxyExternalImage/);
  assert.match(routeSource, /namespace: "google-drive-image"/);
  assert.match(routeSource, /MAX_OBJECT_BYTES = 8 \* 1024 \* 1024/);
  assert.match(routeSource, /lh3\.googleusercontent\.com\/d/);
});

test("画像cacheは件数・総bytes・単一object bytesを制限する", () => {
  assert.match(helperSource, /DEFAULT_MAX_CACHE_ENTRIES = 600/);
  assert.match(helperSource, /DEFAULT_MAX_CACHE_BYTES = 24 \* 1024 \* 1024/);
  assert.match(helperSource, /DEFAULT_MAX_OBJECT_BYTES = 8 \* 1024 \* 1024/);
  assert.match(helperSource, /store\.totalBytes/);
  assert.match(helperSource, /buffer\.byteLength > options\.maxObjectBytes/);
});

test("同一画像の同時missを集約しETagで304再検証する", () => {
  assert.match(helperSource, /inFlight: Map/);
  assert.match(helperSource, /store\.inFlight\.get/);
  assert.match(helperSource, /if-none-match/);
  assert.match(helperSource, /upstream\.status === 304/);
  assert.match(helperSource, /"coalesced"/);
});

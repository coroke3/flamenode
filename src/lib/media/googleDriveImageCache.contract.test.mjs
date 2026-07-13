import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../../app/api/google-drive-image/[id]/route.ts", import.meta.url),
  "utf8",
);

test("画像キャッシュは件数と総バイト数の両方で制限する", () => {
  assert.match(source, /const MAX_CACHE_ENTRIES = 600/);
  assert.match(source, /const MAX_IMAGE_CACHE_BYTES = 24 \* 1024 \* 1024/);
  assert.match(source, /entry\.bytes\.byteLength/);
  assert.match(source, /totalBytes <= MAX_IMAGE_CACHE_BYTES/);
  assert.match(source, /pruneImageCache\(\)/);
});

test("取得した画像レスポンスはキャッシュ退避後も従来どおり返す", () => {
  const storeIndex = source.indexOf("imageCache.set(id, entry)");
  const pruneIndex = source.indexOf("pruneImageCache()", storeIndex);
  const responseIndex = source.indexOf('return imageResponse(entry, "miss")', storeIndex);
  assert.ok(storeIndex >= 0);
  assert.ok(pruneIndex > storeIndex);
  assert.ok(responseIndex > pruneIndex);
});

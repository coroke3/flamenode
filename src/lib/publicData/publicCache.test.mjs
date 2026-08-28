import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./publicCache.ts", import.meta.url), "utf8");

test("public cache は envelope と生 payload の両方を解釈する", () => {
  assert.match(source, /export function unwrapPublicJsonCachePayload/);
  assert.match(source, /export function coercePublicJsonCacheEnvelope/);
  assert.match(source, /export function isPublicJsonCacheEnvelope/);
  assert.match(
    source,
    /isPublicJsonCacheEnvelope\(value\)[\s\S]*?return value\.payload as T/,
  );
});

test("public cache は JSON parse 前後を16MiBで制限する", () => {
  assert.match(source, /PUBLIC_JSON_CACHE_MAX_BYTES = 16 \* 1024 \* 1024/);
  assert.match(source, /contentLengthBytes\(response\)/);
  assert.match(source, /declaredBytes > PUBLIC_JSON_CACHE_MAX_BYTES/);
  assert.match(source, /await cancelResponseBodyBestEffort\(response\)/);
  assert.match(source, /const bytes = await response\.arrayBuffer\(\)/);
  assert.match(source, /bytes\.byteLength > PUBLIC_JSON_CACHE_MAX_BYTES/);
  assert.match(source, /JSON\.parse\(new TextDecoder\(\)\.decode\(bytes\)\)/);
  assert.doesNotMatch(source, /await matched\.json\(\)/);
});

test("public cache write もUTF-8 byte上限を超えるentryを作らない", () => {
  const fnStart = source.indexOf("export function writePublicJsonCacheBestEffort");
  const encodeIndex = source.indexOf("new TextEncoder().encode(serialized).byteLength", fnStart);
  const putIndex = source.indexOf(".default.put(", fnStart);
  assert.ok(fnStart >= 0 && encodeIndex > fnStart);
  assert.ok(putIndex > encodeIndex);
  assert.match(
    source.slice(fnStart, putIndex),
    /byteLength > PUBLIC_JSON_CACHE_MAX_BYTES/,
  );
});

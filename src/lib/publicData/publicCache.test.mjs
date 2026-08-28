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

test("public cache は JSON parse 前にstreamを16MiBで制限する", () => {
  assert.match(source, /PUBLIC_JSON_CACHE_MAX_BYTES = 16 \* 1024 \* 1024/);
  assert.match(source, /contentLengthBytes\(response\)/);
  assert.match(source, /declaredBytes > PUBLIC_JSON_CACHE_MAX_BYTES/);
  assert.match(source, /await cancelResponseBodyBestEffort\(response\)/);
  assert.match(source, /const reader = body\.getReader\(\)/);
  assert.match(source, /if \(total > maxBytes\)/);
  assert.match(source, /await reader\.cancel\(\)\.catch\(\(\) => undefined\)/);
  assert.match(source, /JSON\.parse\(new TextDecoder\(\)\.decode\(bytes\)\)/);
  assert.doesNotMatch(source, /await matched\.json\(\)/);
  assert.doesNotMatch(source, /response\.arrayBuffer\(\)/);
});

test("public cache write もUTF-8 byte上限を超えるentryを作らない", () => {
  const fnStart = source.indexOf("export function writePublicJsonCacheBestEffort");
  const byteGuardIndex = source.indexOf(
    "utf8ByteLengthExceeds(serialized, PUBLIC_JSON_CACHE_MAX_BYTES)",
    fnStart,
  );
  const putIndex = source.indexOf(".default.put(", fnStart);
  assert.ok(fnStart >= 0 && byteGuardIndex > fnStart);
  assert.ok(putIndex > byteGuardIndex);
  assert.match(source, /function utf8ByteLengthExceeds/);
});

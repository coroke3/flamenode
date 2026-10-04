import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  publicJsonCacheFreshness,
  publicJsonCacheRetentionTtl,
} from "./publicCachePolicy.ts";

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

test("public cache write は非JSON値とUTF-8 byte上限超過entryを作らない", () => {
  const fnStart = source.indexOf("export function writePublicJsonCacheBestEffort");
  const stringGuardIndex = source.indexOf(
    'typeof serialized !== "string"',
    fnStart,
  );
  const byteGuardIndex = source.indexOf(
    "utf8ByteLengthExceeds(serialized, PUBLIC_JSON_CACHE_MAX_BYTES)",
    fnStart,
  );
  const putIndex = source.indexOf(".default.put(", fnStart);
  assert.ok(fnStart >= 0 && stringGuardIndex > fnStart);
  assert.ok(byteGuardIndex > stringGuardIndex);
  assert.ok(putIndex > byteGuardIndex);
  assert.match(source, /function utf8ByteLengthExceeds/);
  assert.match(
    source,
    /function utf8ByteLengthUpTo\(value: string, limit: number\): number \| null \{[\s\S]*?if \(value\.length <= Math\.floor\(limit \/ 3\)\) return value\.length \* 3;[\s\S]*?let bytes = 0;/,
  );
});

test("UTF-16 code unit の3倍をbyte上限の安全な上界として扱える", () => {
  const limit = 60;
  const maxCodeUnits = Math.floor(limit / 3);
  const values = [
    "x".repeat(maxCodeUnits),
    "漢".repeat(maxCodeUnits),
    "😀".repeat(maxCodeUnits / 2),
    "\uD800".repeat(maxCodeUnits),
  ];
  for (const value of values) {
    assert.ok(value.length <= maxCodeUnits);
    assert.ok(new TextEncoder().encode(value).byteLength <= limit);
  }
});

test("stale envelope はfresh TTLを超えた時だけ bounded stale として扱う", () => {
  const envelope = { stored_at: 100 };
  assert.equal(publicJsonCacheFreshness(envelope, 110, 30, 120), "fresh");
  assert.equal(publicJsonCacheFreshness(envelope, 131, 30, 120), "stale");
  assert.equal(publicJsonCacheFreshness(envelope, 221, 30, 120), "expired");
  assert.equal(publicJsonCacheFreshness(envelope, 99, 30, 120), "expired");
});

test("Cache API retention covers the entire configured stale window", () => {
  assert.equal(publicJsonCacheRetentionTtl(60, 600), 600);
  assert.equal(publicJsonCacheRetentionTtl(600, 60), 600);
  assert.equal(publicJsonCacheRetentionTtl(0, 0), 1);
});

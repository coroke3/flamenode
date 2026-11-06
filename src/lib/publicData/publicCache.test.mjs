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

test("stale fallback never accepts non-finite age bounds", () => {
  const envelope = { stored_at: 100 };
  assert.equal(publicJsonCacheFreshness(envelope, 131, 30, 120), "stale");
  assert.equal(publicJsonCacheFreshness(envelope, 131, 30, Number.POSITIVE_INFINITY), "expired");
  assert.equal(publicJsonCacheFreshness(envelope, 131, 30, Number.NaN), "expired");
  assert.equal(publicJsonCacheFreshness(envelope, 131, 30, Number.NEGATIVE_INFINITY), "expired");
  // The cache-first default intentionally uses an unbounded *fresh* window.
  assert.equal(publicJsonCacheFreshness(envelope, 100_000, Number.POSITIVE_INFINITY), "fresh");
  assert.equal(publicJsonCacheFreshness(envelope, 110, 30, Number.POSITIVE_INFINITY), "fresh");
});

test("Cache API retention is always finite with malformed fresh/stale TTL", () => {
  for (const [fresh, stale, expected] of [
    [Number.NaN, 600, 600],
    [60, Number.NaN, 60],
    [Number.POSITIVE_INFINITY, 600, 600],
    [600, Number.NEGATIVE_INFINITY, 600],
    [Number.MAX_VALUE, 60, 60],
    [Number.NaN, Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 0, 1],
    [Number.NEGATIVE_INFINITY, Number.MAX_VALUE, 1],
    [-100, 0, 1],
    [0.9, 0.2, 1],
    [12.9, 120.8, 120],
  ]) {
    const ttl = publicJsonCacheRetentionTtl(fresh, stale);
    assert.equal(ttl, expected, `fresh=${String(fresh)} stale=${String(stale)}`);
    assert.ok(Number.isSafeInteger(ttl) && ttl >= 1);
  }
});

test("Cache API writer normalizes TTL before isolate and edge-cache writes", () => {
  const start = source.indexOf("export function writePublicJsonCacheBestEffort(");
  const end = source.indexOf("// MIG-0614:", start);
  assert.ok(start >= 0 && end > start);
  const writer = source.slice(start, end);
  assert.match(writer, /const safeTtl = publicJsonCacheRetentionTtl\(ttlSeconds\)/);
  assert.match(
    writer,
    /writePublicJsonIsolateCache\(\s*r2Key,\s*payload,\s*safeTtl,/,
  );
  assert.match(writer, /`public, max-age=\$\{safeTtl\}`/);
  assert.doesNotMatch(writer, /Math\.floor\(ttlSeconds\)/);
});

test("uncacheable replacement invalidates an old isolate entry", () => {
  const start = source.indexOf("export function writePublicJsonCacheBestEffort(");
  const end = source.indexOf("// MIG-0614:", start);
  assert.ok(start >= 0 && end > start);
  const writer = source.slice(start, end);
  // JSON.stringify(undefined) produces no serialized JSON; never keep an earlier snapshot.
  assert.match(writer, /if \(typeof serialized !== "string"\) \{\s*if \(!options\?\.bypassIsolate\) deletePublicJsonIsolateCache\(r2Key\);/);
  // Throwing JSON.stringify (e.g. a cyclic object) also invalidates the old isolate entry.
  assert.ok(writer.includes("if (!options?.bypassIsolate) deletePublicJsonIsolateCache(r2Key);"));
  assert.match(writer, /catch\\s*\\{/);
  // Oversized replacements can be cached in the edge tier but not in the isolate tier.
  assert.match(writer, /if \(isolateByteWeight === null\) \{\s*deletePublicJsonIsolateCache\(r2Key\);/);
});

test("Cache API retention covers the entire configured stale window", () => {
  assert.equal(publicJsonCacheRetentionTtl(60, 600), 600);
  assert.equal(publicJsonCacheRetentionTtl(600, 60), 600);
  assert.equal(publicJsonCacheRetentionTtl(0, 0), 1);
});

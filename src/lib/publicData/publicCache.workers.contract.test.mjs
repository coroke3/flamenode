import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./publicCache.ts", import.meta.url), "utf8");

test("public cache best-effort writeはwaitUntil無しでCache API I/Oを開始しない", () => {
  const fnStart = source.indexOf("export function writePublicJsonCacheBestEffort");
  const isolateWriteIndex = source.indexOf(
    "writePublicJsonIsolateCache(r2Key, payload, ttlSeconds)",
    fnStart,
  );
  const waitUntilIndex = source.indexOf("const waitUntil = resolveWaitUntil()", fnStart);
  const guardIndex = source.indexOf("if (!waitUntil) return", waitUntilIndex);
  const putIndex = source.indexOf(".default.put(", fnStart);
  assert.ok(fnStart >= 0 && isolateWriteIndex > fnStart);
  assert.ok(waitUntilIndex > isolateWriteIndex);
  assert.ok(guardIndex > waitUntilIndex && putIndex > guardIndex);
  assert.doesNotMatch(source.slice(fnStart), /void putPromise/);
  assert.match(source.slice(fnStart), /waitUntil\(putPromise\.catch\(\(\) => undefined\)\)/);
});

test("Cache API read は isolate 解析キャッシュを先に見る", () => {
  const fnStart = source.indexOf("export async function readPublicJsonCache");
  const isolateRead = source.indexOf("readPublicJsonIsolateCache(r2Key)", fnStart);
  const matchIndex = source.indexOf("cache.match(", fnStart);
  assert.ok(isolateRead > fnStart && matchIndex > isolateRead);
});

test("Cache API delete は isolate エントリも落とす", () => {
  const fnStart = source.indexOf("export async function deletePublicJsonCache");
  const isolateDelete = source.indexOf("deletePublicJsonIsolateCache(r2Key)", fnStart);
  const cacheDelete = source.indexOf(".default.delete(", fnStart);
  assert.ok(isolateDelete > fnStart && cacheDelete > isolateDelete);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./publicCache.ts", import.meta.url), "utf8");

test("public cache best-effort writeはwaitUntil無しでCache API I/Oを開始しない", () => {
  const fnStart = source.indexOf("export function writePublicJsonCacheBestEffort");
  const waitUntilIndex = source.indexOf("const waitUntil = resolveWaitUntil()", fnStart);
  const guardIndex = source.indexOf("if (!waitUntil) return", waitUntilIndex);
  const putIndex = source.indexOf(".default.put(", fnStart);
  assert.ok(fnStart >= 0 && waitUntilIndex > fnStart);
  assert.ok(guardIndex > waitUntilIndex && putIndex > guardIndex);
  assert.doesNotMatch(source.slice(fnStart), /void putPromise/);
  assert.match(source.slice(fnStart), /waitUntil\(putPromise\.catch\(\(\) => undefined\)\)/);
});

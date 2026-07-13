import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseExternalRetryAfterMs } from "./externalImageProxy.ts";

const source = await readFile(new URL("./externalImageProxy.ts", import.meta.url), "utf8");

test("外部画像Retry-Afterは秒・HTTP-date・上限を解釈する", () => {
  assert.equal(parseExternalRetryAfterMs("5", 60_000), 5_000);
  assert.equal(parseExternalRetryAfterMs("120", 60_000), 60_000);
  assert.equal(
    parseExternalRetryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 60_000, 1_000),
    4_000,
  );
});

test("外部画像はinline retryせずnegative cacheとstaleを優先する", () => {
  assert.match(source, /store\.failures\.set/);
  assert.match(source, /Math\.max\(options\.failureTtlMs, retryAfter \?\? 0\)/);
  assert.match(source, /cached && cached\.staleUntil > now/);
  assert.doesNotMatch(source, /for \(let attempt/);
});

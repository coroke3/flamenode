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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./[...key]/route.ts", import.meta.url), "utf8");

test("public media never returns cached bytes before binding and D1 authorization", () => {
  assert.match(source, /isValidPublicMediaKey\(rawKey\)/);
  assert.doesNotMatch(source, /getCachedPublicMediaResponse/);
  assert.match(source, /getEnv\(\)/);
  assert.match(source, /servePublicMedia\(env, rawKey, request\)/);
});

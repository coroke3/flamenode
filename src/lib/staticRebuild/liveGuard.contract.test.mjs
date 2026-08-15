import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./liveGuard.ts", import.meta.url),
  "utf8",
);

test("live API guard converts binding failures to a private 503 response", () => {
  assert.match(source, /const NO_STORE_HEADERS = \{ \"Cache-Control\": \"no-store\" \}/);
  assert.match(source, /try \{\s*db = getDatabase\(\);[\s\S]*?catch \(err\)/);
  assert.match(source, /error: \"db_unavailable\"/);
  assert.match(source, /function jsonErrorResponse\([\s\S]*?headers: NO_STORE_HEADERS/);
});

test("live API guard keeps all non-success branches no-store", () => {
  const errorBranches = source.match(/return jsonErrorResponse\(/g) ?? [];
  assert.ok(errorBranches.length >= 5);
  assert.match(source, /error: \"invalid_event_id\"/);
  assert.match(source, /error: \"live_api_disabled\"/);
  assert.match(source, /error: \"not_found\"/);
  assert.match(source, /error: \"live_api_error\"/);
});

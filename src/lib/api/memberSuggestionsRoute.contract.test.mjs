import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const routeSource = await readFile(
  new URL("../../../app/api/internal/x-users/search/route.ts", import.meta.url),
  "utf8",
);

test("候補検索APIは既存のid/x_name DTOを維持する", () => {
  assert.match(routeSource, /items:\s*result\.items\.map\(\(item\)\s*=>/);
  assert.match(routeSource, /id:\s*item\.x_user_id/);
  assert.match(routeSource, /x_name:\s*item\.name/);
  assert.doesNotMatch(routeSource, /items:\s*result\.items\s*,/);
});

test("short queries avoid R2 work and index reads have a timeout", () => {
  assert.match(routeSource, /MIN_SEARCH_CHARS\s*=\s*2/);
  assert.match(
    routeSource,
    /const compactQueryLength\s*=\s*compactSearchChars\(\s*normalizedQueryForMinLength,?\s*\)[\s\S]*?if \(compactQueryLength\s*<\s*MIN_SEARCH_CHARS\)/,
  );
  assert.match(routeSource, /INDEX_LOAD_TIMEOUT_MS\s*=\s*2500/);
  assert.match(routeSource, /suggestions_index_timeout/);
  assert.match(routeSource, /Retry-After.*3/);
});

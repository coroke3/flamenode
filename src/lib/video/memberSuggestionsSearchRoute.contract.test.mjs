import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const route = await readFile(
  new URL("../../../app/api/internal/x-users/search/route.ts", import.meta.url),
  "utf8",
);

test("3文字以上のV2候補はhasMoreを確定できない末尾ページでV1へfallbackする", () => {
  assert.match(route, /compactQueryLength <= 2/);
  assert.match(route, /searched\.result\.items\.length === limit/);
  assert.match(route, /searched\.result\.hasMore/);
  assert.match(
    route,
    /!item\.matchedBy\.startsWith\("fuzzy_"\)/,
  );
});

test("query budget超過はpartial順位を返さず絞り込みを要求する", () => {
  assert.match(route, /v2\.reason === "query_budget_exceeded"/);
  assert.match(route, /return refineQueryResponse/);
});

test("limit/offsetは固定長の10進整数だけをbounded値として受ける", () => {
  assert.match(route, /const MAX_NUMERIC_PARAM_LENGTH = 8/);
  assert.match(route, /\.trim\(\)\.slice\(0, MAX_NUMERIC_PARAM_LENGTH\)/);
  assert.match(route, /if \(!\/\^\\d\+\$\/\.test\(raw\)\) return fallback/);
  assert.match(route, /Number\.parseInt\(raw, 10\)/);
  assert.match(route, /Number\.isSafeInteger\(parsed\)/);
  assert.doesNotMatch(route, /Number\(url\.searchParams\.get\("limit"\)/);
  assert.doesNotMatch(route, /Number\(url\.searchParams\.get\("offset"\)/);
});

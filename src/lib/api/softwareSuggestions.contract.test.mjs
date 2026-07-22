import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseBoundedPositiveInt } from "./publicApi.ts";
import { MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT } from "./publicDto.ts";

const route = await readFile(
  new URL("../../../app/api/software/suggestions/route.ts", import.meta.url),
  "utf8",
);

test("software suggestion limitは0・非数値を既定値、負数を1、超過値を上限へ閉じる", () => {
  assert.equal(parseBoundedPositiveInt("-1", 20, MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT), 1);
  assert.equal(parseBoundedPositiveInt("0", 20, MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT), 20);
  assert.equal(parseBoundedPositiveInt("NaN", 20, MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT), 20);
  assert.equal(parseBoundedPositiveInt("999", 20, MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT), 50);
});

test("software suggestion routeは全検索分岐をactive限定にする", () => {
  assert.match(route, /activeSoftware\s*=\s*eq\(softwareCatalog\.is_active,\s*1\)/);
  assert.match(route, /\.where\(activeSoftware\)/);
  assert.match(route, /\.where\(and\(activeSoftware,\s*inArray\(softwareCatalog\.id,\s*ids\)\)\)/);
  assert.match(route, /\.where\(\s*and\(activeSoftware,\s*sql`/);
});

test("software suggestion routeは公開DTO境界と禁止key検査を通す", () => {
  assert.match(route, /\.map\(toPublicSoftwareSuggestionDto\)/);
  assert.match(route, /assertNoForbiddenKeys\(payload\)/);
  assert.doesNotMatch(route, /Math\.min\(Number\(/);
});

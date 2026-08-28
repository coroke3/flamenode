import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(
  new URL("../../../app/(public)/list/page.tsx", import.meta.url),
  "utf8",
);

test("公開作品一覧は重複searchParamsを文字列へscalar化する", () => {
  assert.match(page, /type SearchParamValue = string \| string\[\] \| undefined/);
  assert.match(page, /function firstSearchParam\(value: SearchParamValue/);
  assert.match(page, /Array\.isArray\(value\)/);
  assert.match(page, /const q = firstSearchParam\(raw\.q\)/);
  assert.match(page, /const rawPage = firstSearchParam\(raw\.page, "1"\)/);
  assert.doesNotMatch(page, /const \{\s*q = ""/s);
});

test("公開作品一覧はpageを有限・上限付きの完全な10進整数へ正規化する", () => {
  assert.match(page, /const MAX_PAGE = 100_000/);
  assert.match(page, /const raw = value\.trim\(\)\.slice\(0, 12\)/);
  assert.match(page, /if \(!\/\^\\d\+\$\/\.test\(raw\)\) return 1/);
  assert.match(page, /Number\.parseInt\(raw, 10\)/);
  assert.match(page, /Number\.isSafeInteger\(parsed\)/);
  assert.match(page, /Math\.min\(parsed, MAX_PAGE\)/);
});

test("公開作品一覧はquery入力をloaderと再生成URLの両方でbounded値に統一する", () => {
  assert.match(page, /const event = rawEvent\.trim\(\)\.slice\(0, MAX_EVENT_ID_LENGTH\)/);
  assert.match(page, /const sort = parsePublicVideoSort\(rawSort\.slice\(0, 16\)\)/);
  assert.match(page, /defaultValue=\{boundedQuery\}/);
  assert.match(page, /q: boundedQuery,\s*sort,\s*page,\s*event,\s*view,/s);
  assert.doesNotMatch(page, /defaultValue=\{q\}/);
  assert.doesNotMatch(page, /eventId: event\.trim\(\)/);
});

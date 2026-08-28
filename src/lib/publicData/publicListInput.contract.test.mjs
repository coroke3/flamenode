import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(
  new URL("../../../app/(public)/list/page.tsx", import.meta.url),
  "utf8",
);

test("公開作品一覧はpageを有限・上限付きで正規化する", () => {
  assert.match(page, /const MAX_PAGE = 100_000/);
  assert.match(page, /Number\.parseInt\(value\.trim\(\)\.slice\(0, 12\), 10\)/);
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

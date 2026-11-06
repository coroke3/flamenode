import test from "node:test";
import assert from "node:assert/strict";

import { escapeLike, clampPaging, totalPagesFor } from "./sql.ts";

test("escapeLike: % と _ と \\ をエスケープ", () => {
  assert.equal(escapeLike("a%b"), "a\\%b");
  assert.equal(escapeLike("a_b"), "a\\_b");
  assert.equal(escapeLike("a\\b"), "a\\\\b");
  assert.equal(escapeLike("通常文字列"), "通常文字列");
  assert.equal(escapeLike(""), "");
  assert.equal(escapeLike(null), "");
  assert.equal(escapeLike(undefined), "");
});

test("clampPaging: page / pageSize / offset", () => {
  const r1 = clampPaging({ page: 1, pageSize: 50, defaultPageSize: 50, maxPageSize: 500 });
  assert.deepEqual(r1, { page: 1, pageSize: 50, offset: 0 });

  const r2 = clampPaging({ page: 3, pageSize: 20, defaultPageSize: 50, maxPageSize: 500 });
  assert.deepEqual(r2, { page: 3, pageSize: 20, offset: 40 });

  const r3 = clampPaging({ page: 0, pageSize: -5, defaultPageSize: 50, maxPageSize: 500 });
  assert.deepEqual(r3, { page: 1, pageSize: 50, offset: 0 });

  const r4 = clampPaging({ page: 1, pageSize: 9999, defaultPageSize: 50, maxPageSize: 500 });
  assert.deepEqual(r4, { page: 1, pageSize: 500, offset: 0 });
});

test("clampPaging: oversized query page never creates an imprecise SQLite OFFSET", () => {
  const options = { pageSize: 50, defaultPageSize: 50, maxPageSize: 50 };
  for (const page of [Number.MAX_SAFE_INTEGER, "9007199254740993", "1e100", Infinity]) {
    assert.deepEqual(clampPaging({ ...options, page }), { page: 1, pageSize: 50, offset: 0 },
      `unsafe page input ${String(page)} must not reach SQL OFFSET`);
  }

  const largestPage = Math.floor(Number.MAX_SAFE_INTEGER / 50) + 1;
  const valid = clampPaging({ ...options, page: largestPage });
  assert.deepEqual(valid, { page: largestPage, pageSize: 50, offset: (largestPage - 1) * 50 });
  assert.equal(Number.isSafeInteger(valid.offset), true, "the largest accepted OFFSET must be exact");

  assert.deepEqual(clampPaging({ ...options, page: largestPage + 1 }), {
    page: 1, pageSize: 50, offset: 0,
  }, "page immediately after safe bound must fall back");

  // Keep CURRENT's normal and fractional-page interpretation.
  assert.deepEqual(clampPaging({ ...options, page: "3.9" }), { page: 3, pageSize: 50, offset: 100 });
});

test("totalPagesFor", () => {
  assert.equal(totalPagesFor(0, 50), 1);
  assert.equal(totalPagesFor(50, 50), 1);
  assert.equal(totalPagesFor(51, 50), 2);
  assert.equal(totalPagesFor(100, 30), 4);
});

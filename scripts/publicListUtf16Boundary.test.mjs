import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeListQuery } from "../apps/site/src/lib/listQuery.ts";

test("public list search never ends on a truncated emoji surrogate at 100 UTF-16 units", () => {
  const prefix99 = "x".repeat(99);
  const prefix98 = "x".repeat(98);
  assert.equal(normalizeListQuery({ q: prefix99 + "😀tail" }).q, prefix99);
  assert.equal(normalizeListQuery({ q: prefix98 + "😀tail" }).q, prefix98 + "😀");
  assert.equal(normalizeListQuery({ q: "😀".repeat(50) + "tail" }).q, "😀".repeat(50));
  assert.equal(normalizeListQuery({ q: "a".repeat(101) }).q, "a".repeat(100));
  assert.equal(normalizeListQuery({ q: "  a  " }).q, "a");
});

test("CURRENT list and API plus Hono migration enforce the same Unicode boundary", () => {
  const files = [
    "app/(public)/list/ListIndexView.tsx",
    "app/api/videos/route.ts",
    "apps/api/src/routes/videos/list.ts",
    "apps/site/src/lib/listQuery.ts",
  ];
  const boundaryGuard = "replace(/[\\uD800-\\uDBFF]$/, \"\")";
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(source.includes(boundaryGuard), file + " lacks surrogate-boundary guard");
  }
});

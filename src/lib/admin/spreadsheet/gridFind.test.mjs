import test from "node:test";
import assert from "node:assert/strict";
import { findNextSpreadsheetMatch } from "./gridFind.ts";

const columns = [
  { name: "a", type: "TEXT", notNull: false, pk: 0, editable: true },
];

test("findNextSpreadsheetMatch finds next row", () => {
  const r = findNextSpreadsheetMatch({
    rows: [{ a: "foo" }, { a: "bar" }],
    columns,
    query: "bar",
    from: { rowIndex: 0, colIndex: 0 },
  });
  assert.equal(r.found, true);
  assert.deepEqual(r.pos, { rowIndex: 1, colIndex: 0 });
});

test("findNextSpreadsheetMatch returns not found when no other match", () => {
  const r = findNextSpreadsheetMatch({
    rows: [{ a: "only" }],
    columns,
    query: "only",
    from: { rowIndex: 0, colIndex: 0 },
  });
  assert.equal(r.found, false);
});

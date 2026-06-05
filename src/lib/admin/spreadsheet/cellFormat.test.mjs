import test from "node:test";
import assert from "node:assert/strict";
import {
  cellMatchesFind,
  matchSpreadsheetColumnName,
  parseSpreadsheetCellInput,
} from "#spreadsheet/cellFormat";

test("parseSpreadsheetCellInput treats NULL and empty as null", () => {
  assert.equal(parseSpreadsheetCellInput(""), null);
  assert.equal(parseSpreadsheetCellInput("  null  "), null);
  assert.equal(parseSpreadsheetCellInput("  a  "), "a");
});

test("parseSpreadsheetCellInput preserveWhitespace keeps source", () => {
  assert.equal(
    parseSpreadsheetCellInput("  x  ", { preserveWhitespace: true }),
    "  x  ",
  );
});

test("cellMatchesFind is case-insensitive by default", () => {
  assert.equal(cellMatchesFind({ x: "Hello" }, "ell", false), true);
  assert.equal(cellMatchesFind({ x: "Hello" }, "ELL", false), true);
});

test("matchSpreadsheetColumnName matches case-insensitively", () => {
  assert.equal(
    matchSpreadsheetColumnName("User_Id", ["user_id", "name"]),
    "user_id",
  );
  assert.equal(
    matchSpreadsheetColumnName("Name", [{ name: "name" }]),
    "name",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  estimateSpreadsheetImportD1Statements,
  isSpreadsheetImportBatchSizeAllowed,
  SPREADSHEET_D1_BATCH_STATEMENT_LIMIT,
  SPREADSHEET_D1_BATCH_STATEMENT_RESERVE,
  SPREADSHEET_IMPORT_MAX_BATCH_ROWS,
} from "./constants.ts";

const querySource = await readFile(
  fileURLToPath(new URL("./query.ts", import.meta.url)),
  "utf8",
);
const constantsSource = await readFile(
  fileURLToPath(new URL("./constants.ts", import.meta.url)),
  "utf8",
);
const importRouteSource = await readFile(
  fileURLToPath(new URL("../../../../app/api/admin/spreadsheet/import/route.ts", import.meta.url)),
  "utf8",
);

test("spreadsheet writes use one strict audit batch", () => {
  assert.match(querySource, /mutateWithAudit\(db/);
  assert.match(querySource, /expectedMutationChanges: mutations\.map\(\(\) => 1\)/);
  assert.match(querySource, /strict: true/);
  assert.match(querySource, /after: row/);
  assert.doesNotMatch(querySource, /await writeHistory/);
});

test("spreadsheet page and export mask pattern-matched secret columns", () => {
  assert.match(querySource, /if \(!isSpreadsheetSecretColumn\(column\)\) return value/);
  assert.match(querySource, /rows: rawRows\.map\(\(r\) => serializeRow\(r, columns\)\)/);
});

test("spreadsheet import rejects invalid rows before mutation and caps D1 batch size", () => {
  assert.match(querySource, /const errors: Array/);
  assert.match(querySource, /if \(errors\.length > 0\) return \{ inserted: 0/);
  assert.match(querySource, /if \(!isSpreadsheetImportBatchSizeAllowed\(opts\.rows\.length\)\)/);
  assert.match(constantsSource, /SPREADSHEET_IMPORT_MAX_ROWS = 500/);
  assert.equal(SPREADSHEET_IMPORT_MAX_BATCH_ROWS, 15);
});

test("spreadsheet D1 budget accepts 15 rows and rejects 16 without weakening reserve", () => {
  assert.equal(SPREADSHEET_D1_BATCH_STATEMENT_LIMIT, 50);
  assert.equal(SPREADSHEET_D1_BATCH_STATEMENT_RESERVE, 10);
  assert.equal(estimateSpreadsheetImportD1Statements(15), 50);
  assert.equal(estimateSpreadsheetImportD1Statements(16), 52);
  assert.equal(isSpreadsheetImportBatchSizeAllowed(15), true);
  assert.equal(isSpreadsheetImportBatchSizeAllowed(16), false);
});

test("spreadsheet import does not silently omit readonly or unknown columns", () => {
  assert.match(importRouteSource, /invalidColumns/);
  assert.match(importRouteSource, /assertSpreadsheetImportColumns/);
  assert.doesNotMatch(importRouteSource, /omitReadonlyImportColumns/);
});

test("spreadsheet foreign-key prevalidation deduplicates values into bounded IN queries", () => {
  assert.match(querySource, /new Set\(/);
  assert.match(querySource, /IN \(\$\{placeholders\}\)/);
  assert.match(querySource, /offset \+= 99/);
});

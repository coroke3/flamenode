import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

test("spreadsheet import rejects invalid rows before mutation and caps D1 batch size", () => {
  assert.match(querySource, /const errors: Array/);
  assert.match(querySource, /if \(errors\.length > 0\) return \{ inserted: 0/);
  assert.match(querySource, /if \(opts\.rows\.length > SPREADSHEET_IMPORT_MAX_BATCH_ROWS\)/);
  assert.match(constantsSource, /SPREADSHEET_IMPORT_MAX_ROWS = 500/);
  assert.match(constantsSource, /SPREADSHEET_IMPORT_MAX_BATCH_ROWS = 20/);
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

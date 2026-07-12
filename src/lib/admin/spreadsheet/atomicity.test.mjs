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

test("spreadsheet writes use one strict audit batch", () => {
  assert.match(querySource, /mutateWithAudit\(db/);
  assert.match(querySource, /expectedMutationChanges: mutations\.map\(\(\) => 1\)/);
  assert.match(querySource, /strict: true/);
  assert.match(querySource, /after: fullInsertedRow\(ctx, row\)/);
  assert.doesNotMatch(querySource, /await writeHistory/);
});

test("spreadsheet import rejects invalid rows before mutation and caps D1 batch size", () => {
  assert.match(querySource, /const errors: Array/);
  assert.match(querySource, /if \(errors\.length > 0\) return \{ inserted: 0/);
  assert.match(querySource, /if \(opts\.rows\.length > SPREADSHEET_IMPORT_MAX_BATCH_ROWS\)/);
  assert.match(constantsSource, /SPREADSHEET_IMPORT_MAX_ROWS = 500/);
  assert.match(constantsSource, /SPREADSHEET_IMPORT_MAX_BATCH_ROWS = 20/);
});

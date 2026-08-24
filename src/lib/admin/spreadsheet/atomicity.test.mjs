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
  SPREADSHEET_IMPORT_MAX_STATIC_REBUILD_QUEUE_STATEMENTS,
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
  assert.match(querySource, /buildStaticRebuildQueueBatch\(db, staticRebuildTargets\)/);
  assert.match(querySource, /\.\.\.queue\.statements/);
  assert.match(querySource, /\.\.\.queue\.expectedChanges/);
  assert.match(querySource, /staticRebuildWakeSource:/);
  assert.match(querySource, /queue\.statements\.length > 0 \? "admin" : undefined/);
  assert.match(querySource, /strict: true/);
  assert.match(querySource, /after: row/);
  assert.match(querySource, /buildPreviewRunConsumptionMutation/);
  assert.match(querySource, /isNull\(spreadsheetImportRuns\.consumed_at\)/);
  assert.match(querySource, /gte\(spreadsheetImportRuns\.expires_at, consumedAt\)/);
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
  assert.match(querySource, /\.limit\(SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT \+ 1\)/);
  assert.match(querySource, /SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED/);
  assert.match(constantsSource, /SPREADSHEET_IMPORT_MAX_ROWS = 500/);
  assert.equal(SPREADSHEET_IMPORT_MAX_BATCH_ROWS, 7);
});

test("spreadsheet D1 budget keeps the bounded row count plus the worst four queue statements at 50", () => {
  assert.equal(SPREADSHEET_D1_BATCH_STATEMENT_LIMIT, 50);
  assert.equal(SPREADSHEET_D1_BATCH_STATEMENT_RESERVE, 18);
  assert.equal(SPREADSHEET_IMPORT_MAX_STATIC_REBUILD_QUEUE_STATEMENTS, 4);
  assert.equal(estimateSpreadsheetImportD1Statements(14), 58);
  assert.equal(estimateSpreadsheetImportD1Statements(7, 4), 48);
  assert.equal(estimateSpreadsheetImportD1Statements(8, 4), 52);
  assert.equal(isSpreadsheetImportBatchSizeAllowed(7), true);
  assert.equal(isSpreadsheetImportBatchSizeAllowed(8), false);
  assert.match(querySource, /planD1AuditMutationBudget/);
  assert.match(querySource, /if \(!budget\.withinLimit\)/);
  assert.match(importRouteSource, /applyMaxRows: SPREADSHEET_IMPORT_MAX_BATCH_ROWS/);
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

test("spreadsheet cannot bypass event/video lifecycle transitions with physical deletes", () => {
  assert.match(querySource, /isSpreadsheetPhysicalDeleteBlocked\(ctx\.def\.table\)/);
  assert.match(querySource, /physical_delete_requires_visibility_status/);
});

test("spreadsheet inserts enforce the same column policy as updates and imports", () => {
  assert.match(querySource, /for \(const column of Object\.keys\(opts\.row\)\)/);
  assert.match(querySource, /assertColumnEditable\(ctx, column\)/);
});

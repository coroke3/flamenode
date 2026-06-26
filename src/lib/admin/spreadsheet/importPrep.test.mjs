import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpreadsheetImportLocalPreview,
  prepareSpreadsheetImportRows,
} from "./importPrepCore.ts";
import { SPREADSHEET_IMPORT_MAX_ROWS } from "#spreadsheet/constants";

test("prepareSpreadsheetImportRows parses TSV with header", () => {
  const text = "id\tname\n1\talice\n2\tbob";
  const result = prepareSpreadsheetImportRows({
    text,
    columnNames: ["id", "name"],
    hasHeader: true,
    delimiter: "auto",
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]?.id, "1");
});

test("buildSpreadsheetImportLocalPreview warns on no_rows", () => {
  const preview = buildSpreadsheetImportLocalPreview({
    text: "id\tname\n",
    columnNames: ["id", "name"],
    hasHeader: true,
    delimiter: "auto",
  });
  assert.equal(preview?.rowCount, 0);
  assert.ok(
    preview?.warnings.some((w) => w.includes("取り込む行がありません")),
  );
});

test("prepareSpreadsheetImportRows rejects empty input", () => {
  assert.throws(
    () =>
      prepareSpreadsheetImportRows({
        text: "   ",
        columnNames: ["id"],
        hasHeader: true,
        delimiter: "auto",
      }),
    /no_rows/,
  );
});

test("spreadsheet import parsing stops after the import row cap", () => {
  const lines = ["id\tname"];
  for (let i = 0; i < SPREADSHEET_IMPORT_MAX_ROWS + 20; i++) {
    lines.push(`${i}\tname-${i}`);
  }
  const text = lines.join("\n");

  const preview = buildSpreadsheetImportLocalPreview({
    text,
    columnNames: ["id", "name"],
    hasHeader: true,
    delimiter: "auto",
  });
  assert.equal(preview?.rowCount, SPREADSHEET_IMPORT_MAX_ROWS + 1);
  assert.ok(
    preview?.warnings.some((w) => w.includes(String(SPREADSHEET_IMPORT_MAX_ROWS))),
  );
  assert.throws(
    () =>
      prepareSpreadsheetImportRows({
        text,
        columnNames: ["id", "name"],
        hasHeader: true,
        delimiter: "auto",
      }),
    /too_many_rows/,
  );
});

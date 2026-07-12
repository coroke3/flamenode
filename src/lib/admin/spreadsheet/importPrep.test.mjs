import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSpreadsheetImportColumns,
  buildReadonlyImportColumnWarnings,
  buildSpreadsheetImportLocalPreview,
  omitReadonlyImportColumns,
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

test("header omission does not materialize readonly columns, explicit readonly headers fail", () => {
  const partial = prepareSpreadsheetImportRows({
    text: "id\tname\n1\talice",
    columnNames: ["id", "name", "secret"],
    hasHeader: true,
    delimiter: "tsv",
  });
  assert.deepEqual(Object.keys(partial.rows[0] ?? {}), ["id", "name"]);
  assert.doesNotThrow(() =>
    assertSpreadsheetImportColumns({
      mappedColumns: partial.mappedColumns,
      invalidColumns: partial.invalidColumns,
      columnNames: ["id", "name", "secret"],
      readonlyColumns: ["secret"],
    }),
  );

  const explicit = prepareSpreadsheetImportRows({
    text: "id\tsecret\n1\tvalue",
    columnNames: ["id", "name", "secret"],
    hasHeader: true,
    delimiter: "tsv",
  });
  assert.throws(
    () =>
      assertSpreadsheetImportColumns({
        mappedColumns: explicit.mappedColumns,
        invalidColumns: explicit.invalidColumns,
        columnNames: ["id", "name", "secret"],
        readonlyColumns: ["secret"],
      }),
    /column_not_editable:secret/,
  );
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

test("omitReadonlyImportColumns removes ignored columns before token/apply", () => {
  assert.deepEqual(
    omitReadonlyImportColumns({
      rows: [
        {
          id: "1",
          title: "Title",
          readonly_field: "{}",
          secret_field: "legacy value",
        },
      ],
      readonlyColumns: ["readonly_field", "secret_field"],
    }),
    [
      {
        id: "1",
        title: "Title",
      },
    ],
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

test("buildReadonlyImportColumnWarnings reports ignored readonly columns", () => {
  assert.deepEqual(
    buildReadonlyImportColumnWarnings({
      rows: [{ id: "1", readonly_field: "{}", secret_field: "legacy" }],
      mappedColumns: ["id", "readonly_field", "secret_field"],
      readonlyColumns: ["readonly_field", "secret_field"],
    }),
    ["Readonly columns are ignored on import: readonly_field, secret_field"],
  );
  assert.deepEqual(
    buildReadonlyImportColumnWarnings({
      rows: [{ id: "1" }],
      mappedColumns: ["id"],
      readonlyColumns: ["readonly_field"],
    }),
    [],
  );
});

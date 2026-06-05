import test from "node:test";
import assert from "node:assert/strict";
import {
  getImportPayloadIssue,
  getImportRowCountIssue,
  getImportTextSizeIssue,
  getPrimaryKeyIssue,
  normalizePrimaryKeyRecord,
  primaryKeyFingerprint,
  primaryKeyFromRowValues,
  buildPrimaryKeyFromDisplayRow,
  buildSpreadsheetInsertPayload,
  canEditSpreadsheetGridCell,
  validatePrimaryKeyFromDisplayRow,
} from "#spreadsheet/validation";

test("normalizePrimaryKeyRecord rejects empty pk values", () => {
  assert.throws(
    () => normalizePrimaryKeyRecord(["id"], { id: "" }),
    /missing_primary_key/,
  );
});

test("getPrimaryKeyIssue detects missing columns", () => {
  assert.equal(getPrimaryKeyIssue([], { id: "1" }), "no_primary_key_columns");
});

test("getImportTextSizeIssue ignores row count", () => {
  assert.equal(getImportTextSizeIssue("id\n1"), null);
});

test("getImportRowCountIssue ignores text length when rows exist", () => {
  assert.equal(getImportRowCountIssue(501), "too_many_rows");
  assert.equal(getImportRowCountIssue(0), "no_rows");
});

test("getImportPayloadIssue combines text and row checks", () => {
  assert.equal(getImportPayloadIssue("", 501), "too_many_rows");
});

test("primaryKeyFingerprint is stable across key order", () => {
  assert.equal(
    primaryKeyFingerprint({ b: "2", a: "1" }),
    primaryKeyFingerprint({ a: "1", b: "2" }),
  );
});

test("primaryKeyFromRowValues normalizes import row pk", () => {
  assert.deepEqual(primaryKeyFromRowValues({ id: "42", name: "x" }, ["id"]), {
    id: "42",
  });
});

test("validatePrimaryKeyFromDisplayRow detects empty pk cell", () => {
  assert.equal(
    validatePrimaryKeyFromDisplayRow({ id: "" }, ["id"]),
    "missing_primary_key",
  );
});

test("buildSpreadsheetInsertPayload omits non-editable columns", () => {
  const row = buildSpreadsheetInsertPayload(
    { id: "1", secret: "x", name: "a" },
    [
      { name: "id", pk: 1, editable: true },
      { name: "secret", pk: 0, editable: false },
      { name: "name", pk: 0, editable: true },
    ],
  );
  assert.deepEqual(row, { id: "1", name: "a" });
});

test("canEditSpreadsheetGridCell blocks pk and secret columns", () => {
  assert.equal(
    canEditSpreadsheetGridCell(true, { name: "id", pk: 1, editable: true }),
    false,
  );
  assert.equal(
    canEditSpreadsheetGridCell(true, {
      name: "api_secret",
      pk: 0,
      editable: false,
    }),
    false,
  );
});

test("buildPrimaryKeyFromDisplayRow stringifies object cells", () => {
  const pk = buildPrimaryKeyFromDisplayRow({ meta: { a: 1 } }, ["meta"]);
  assert.equal(pk.meta, '{"a":1}');
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSpreadsheetTableDef } from "../src/routes/admin/spreadsheet/registry.ts";
import { validateSpreadsheetInputValues } from "../src/routes/admin/spreadsheet/writeValidation.ts";

// MIG-0638 U01b: characterization of CURRENT query.ts#validateSpreadsheetInputValues.
// The validation helper has no SQL, network, authorization or production side effects.
function context(table = "events", overrides = {}) {
  const columns = [
    { name: "id", type: "TEXT", notNull: true },
    { name: "review_settings", type: "TEXT", notNull: false },
    { name: "icon_url", type: "TEXT", notNull: false },
    { name: "event_type", type: "TEXT", notNull: false, enumValues: ["event", "collabo"] },
    { name: "visibility_status", type: "TEXT", notNull: false },
    { name: "count", type: "INTEGER", notNull: false },
    { name: "rating", type: "DECIMAL", notNull: false },
    { name: "access_token", type: "TEXT", notNull: false },
    { name: "title", type: "TEXT", notNull: false },
  ];
  return {
    def: resolveSpreadsheetTableDef(table, true),
    columns,
    columnNames: columns.map((c) => c.name),
    ...overrides,
  };
}
function fails(ctx, row, code) {
  assert.throws(() => validateSpreadsheetInputValues(ctx, row), (error) => error instanceof Error && error.message === code);
}

test("accepts valid values and nullable fields without mutating input", () => {
  const ctx = context();
  const row = { title: "Hi", review_settings: '{"ok":true}', event_type: "event", icon_url: "https://example.com/", count: "-42", rating: "2.5" };
  const before = structuredClone(row);
  assert.equal(validateSpreadsheetInputValues(ctx, row), undefined);
  assert.deepEqual(row, before);
  assert.equal(validateSpreadsheetInputValues(ctx, { title: null }), undefined);
  assert.equal(validateSpreadsheetInputValues(ctx, {}), undefined);
});

test("rejects unknown, secret, readonly table and visibility columns", () => {
  const ctx = context();
  fails(ctx, { bogus: "x" }, "unknown_column");
  fails(ctx, { access_token: "secret" }, "column_not_editable");
  fails(ctx, { visibility_status: "public" }, "column_not_editable");
  fails(context("system_settings"), { title: "x" }, "column_not_editable");
  const x = context("x_users", { columns: [{ name: "approval_status", type: "TEXT", notNull: false }], columnNames: ["approval_status"] });
  fails(x, { approval_status: "approved" }, "column_not_editable");
});

test("retains CURRENT validation precedence for nullable and metadata constraints", () => {
  const ctx = context();
  fails(ctx, { id: null }, "not_null_violation");
  fails(ctx, { event_type: "unknown" }, "invalid_enum");
  fails(ctx, { review_settings: "not-json" }, "invalid_json_value");
  assert.equal(validateSpreadsheetInputValues(ctx, { review_settings: "[1,2]" }), undefined);
  fails(ctx, { icon_url: "ftp://example.com/" }, "invalid_url");
  fails(ctx, { icon_url: "not a url" }, "invalid_url");
  assert.equal(validateSpreadsheetInputValues(ctx, { icon_url: "http://example.com/" }), undefined);
  fails(ctx, { icon_url: "x".repeat(2049) }, "value_too_long");
  fails(ctx, { title: "x".repeat(100001) }, "value_too_long");
});

test("matches CURRENT INTEGER/DECIMAL string patterns", () => {
  const ctx = context();
  for (const bad of ["", "2.3", "+1", "0x10", " 10 ", "1e3"]) fails(ctx, { count: bad }, "invalid_integer");
  for (const valid of ["0", "-1", "100"]) assert.equal(validateSpreadsheetInputValues(ctx, { count: valid }), undefined);
  for (const bad of ["", ".5", "1.", "+1", "2e2", "NaN"]) fails(ctx, { rating: bad }, "invalid_number");
  for (const valid of ["-0.5", "1", "0.0"]) assert.equal(validateSpreadsheetInputValues(ctx, { rating: valid }), undefined);
});

test("checks keys in insertion order, preserving CURRENT first-error semantics", () => {
  const ctx = context();
  fails(ctx, { bogus: "1", icon_url: "ftp://example.com" }, "unknown_column");
  fails(ctx, { icon_url: "ftp://example.com", bogus: "1" }, "invalid_url");
});

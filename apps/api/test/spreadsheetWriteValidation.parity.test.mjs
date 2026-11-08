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


test("CURRENT SQLite default resolution preserves numeric, escaped string, null and unsupported codes", async () => {
  const { resolveSpreadsheetDefaultValue } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  assert.equal(resolveSpreadsheetDefaultValue({ defaultValue: null }), null);
  assert.equal(resolveSpreadsheetDefaultValue({ defaultValue: " NULL " }), null);
  assert.equal(resolveSpreadsheetDefaultValue({ defaultValue: "(-2.5)" }), -2.5);
  assert.equal(resolveSpreadsheetDefaultValue({ defaultValue: "'it''s fine'" }), "it's fine");
  assert.match(resolveSpreadsheetDefaultValue({ defaultValue: "CURRENT_TIMESTAMP" }), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(Math.abs(resolveSpreadsheetDefaultValue({ defaultValue: "(unixepoch())" }) - Math.floor(Date.now()/1000)) <= 1);
  assert.throws(() => resolveSpreadsheetDefaultValue({ defaultValue: "randomblob(16)" }), /unsupported_default/);
});

test("CURRENT INSERT normalization fills defaults, omits generated columns and rejects missing required columns", async () => {
  const { prepareCompleteInsertRow } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const base = context("events");
  const ctx = {
    ...base,
    columns: [
      { name: "title", type: "TEXT", notNull: true },
      { name: "count", type: "INTEGER", notNull: false, defaultValue: "42" },
      { name: "comment", type: "TEXT", notNull: false },
      { name: "generated_id", type: "TEXT", notNull: false, generated: true },
    ],
    columnNames: ["title", "count", "comment", "generated_id"],
  };
  const input = { title: "event" };
  assert.deepEqual(prepareCompleteInsertRow(ctx, input), { title: "event", count: 42, comment: null });
  assert.deepEqual(input, { title: "event" });
  assert.deepEqual(prepareCompleteInsertRow(ctx, { title: "event", count: "" }), { title: "event", count: null, comment: null });
  fails(ctx, { title: null }, "not_null_violation");
  assert.throws(() => prepareCompleteInsertRow(ctx, {}), /missing_required_column/);
});


test("CURRENT primary-key normalization enforces missing-key and nonblank contracts", async () => {
  const { normalizeSpreadsheetPrimaryKey, primaryKeyFromSpreadsheetRow } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  assert.throws(() => normalizeSpreadsheetPrimaryKey([], {}), /missing_primary_key/);
  assert.throws(() => normalizeSpreadsheetPrimaryKey(["id"], {}), /missing_primary_key/);
  assert.throws(() => normalizeSpreadsheetPrimaryKey(["id"], { id: "  " }), /missing_primary_key/);
  assert.throws(() => normalizeSpreadsheetPrimaryKey(["id", "locale"], { id: "a" }), /missing_primary_key/);
  assert.deepEqual(normalizeSpreadsheetPrimaryKey(["id", "locale"], { locale: "ja", id: "a", extra: "ignored" }), { id: "a", locale: "ja" });
  assert.deepEqual(normalizeSpreadsheetPrimaryKey(["id"], { id: " a " }), { id: " a " });
  assert.deepEqual(primaryKeyFromSpreadsheetRow({ id: "1", locale: "ja" }, ["locale", "id"]), { locale: "ja", id: "1" });
  assert.throws(() => primaryKeyFromSpreadsheetRow({ id: null }, ["id"]), /missing_primary_key/);
  assert.throws(() => primaryKeyFromSpreadsheetRow({}, ["id"]), /missing_primary_key/);
});


test("CURRENT UPDATE chooses editable non-PK columns in schema order and builds after image", async () => {
  const { prepareSpreadsheetUpdate } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const base = context("events");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
    { name: "count", type: "INTEGER", notNull: false, pk: 0 },
    { name: "access_token", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = { ...base, columns, columnNames: columns.map((c) => c.name) };
  const before = { id: "abc", title: "old", count: 10, access_token: "hidden" };
  const values = { count: "2", title: "" };
  const result = prepareSpreadsheetUpdate(ctx, before, values);
  assert.deepEqual(result.setColumns, ["title", "count"]);
  assert.deepEqual(result.after, { id: "abc", title: null, count: "2", access_token: "hidden" });
  assert.equal(before.title, "old");
  assert.deepEqual(values, { count: "2", title: "" });
  assert.throws(() => prepareSpreadsheetUpdate(ctx, before, {}), /empty_row/);
  assert.throws(() => prepareSpreadsheetUpdate(ctx, before, { id: "new" }), /empty_row/);
  assert.throws(() => prepareSpreadsheetUpdate(ctx, before, { access_token: "x" }), /column_not_editable/);
  assert.throws(() => prepareSpreadsheetUpdate(ctx, before, { invalid: "x" }), /unknown_column/);
});


test("unmounted SQL planners bind every value and enforce optimistic snapshots", async () => {
  const { buildSpreadsheetInsertSql, buildSpreadsheetUpdateSql, buildSpreadsheetDeleteSql } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
    { name: "count", type: "INTEGER", notNull: false, pk: 0 },
  ];
  const ctx = { def: resolveSpreadsheetTableDef("slots", true), primaryKeys: ["id"], columns, columnNames: columns.map(x => x.name) };
  const before = { id: "row-1", title: "previous", count: 3 };
  const hostile = "'); DROP TABLE slots; --";
  const ins = buildSpreadsheetInsertSql(ctx, { id: "row-2", title: hostile, count: "5" });
  assert.match(ins.statement, /^INSERT INTO "slots" \("id", "title", "count"\) VALUES \(\?, \?, \?\)$/);
  assert.deepEqual(ins.binds, ["row-2", hostile, "5"]);
  assert.ok(!ins.statement.includes(hostile));
  const update = buildSpreadsheetUpdateSql(ctx, { id: "row-1" }, before, { title: hostile });
  assert.match(update.statement, /^UPDATE "slots" SET "title" = \? WHERE "id" = \? AND "id" IS \? AND "title" IS \? AND "count" IS \?$/);
  assert.deepEqual(update.binds, [hostile, "row-1", "row-1", "previous", 3]);
  assert.deepEqual(update.after, { id: "row-1", title: hostile, count: 3 });
  const deletion = buildSpreadsheetDeleteSql(ctx, { id: "row-1" }, before);
  assert.match(deletion.statement, /^DELETE FROM "slots" WHERE "id" = \? AND "id" IS \? AND "title" IS \? AND "count" IS \?$/);
  assert.deepEqual(deletion.binds, ["row-1", "row-1", "previous", 3]);
  assert.deepEqual(before, { id: "row-1", title: "previous", count: 3 });
  assert.throws(() => buildSpreadsheetInsertSql(ctx, { title: "missing-id" }), /missing_required_column/);
  assert.throws(() => buildSpreadsheetUpdateSql(ctx, {}, before, { title: "changed" }), /missing_primary_key/);
  assert.throws(() => buildSpreadsheetDeleteSql({ ...ctx, def: resolveSpreadsheetTableDef("videos", true) }, {id:"row-1"}, before), /physical_delete_forbidden/);
  assert.throws(() => buildSpreadsheetDeleteSql({ ...ctx, def: resolveSpreadsheetTableDef("system_settings", true) }, {id:"row-1"}, before), /table_readonly/);
  assert.throws(() => buildSpreadsheetUpdateSql(ctx, { id: "row-1" }, { ...before, count: { unexpected: true } }, {title:"changed"}), /invalid_snapshot/);
});


test("unmounted SQL CAS plan preserves composite key order and nullable snapshot columns", async () => {
  const { buildSpreadsheetUpdateSql, buildSpreadsheetDeleteSql } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
    { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("video_events", true),
    primaryKeys: ["video_id", "event_id"],
    columns,
    columnNames: columns.map(column => column.name),
  };
  const before = { video_id: "v1", event_id: "e1", notes: null };
  const pk = { event_id: "e1", video_id: "v1" };
  const updated = buildSpreadsheetUpdateSql(ctx, pk, before, { notes: "new" });
  assert.equal(
    updated.statement,
    'UPDATE "video_events" SET "notes" = ? WHERE "video_id" = ? AND "event_id" = ? AND "video_id" IS ? AND "event_id" IS ? AND "notes" IS ?',
  );
  assert.deepEqual(updated.binds, ["new", "v1", "e1", "v1", "e1", null]);
  assert.deepEqual(updated.after, { video_id: "v1", event_id: "e1", notes: "new" });
  const deleted = buildSpreadsheetDeleteSql(ctx, pk, before);
  assert.deepEqual(deleted.binds, ["v1", "e1", "v1", "e1", null]);
  assert.equal(deleted.statement.includes('"notes" IS ?'), true);
  assert.deepEqual(before, { video_id: "v1", event_id: "e1", notes: null });
  assert.throws(
    () => buildSpreadsheetDeleteSql(ctx, { event_id: "e1" }, before),
    /missing_primary_key/,
  );
});

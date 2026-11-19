import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSpreadsheetTableDef } from "../src/routes/admin/spreadsheet/registry.ts";
import { validateSpreadsheetInputValues, spreadsheetImportPrimaryKeyFingerprint } from "../src/routes/admin/spreadsheet/writeValidation.ts";

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
  assert.deepEqual(prepareCompleteInsertRow(ctx, { title: "event", count: null }), { title: "event", count: null, comment: null });
  // CURRENT validateSpreadsheetInputValues rejects empty INTEGER before INSERT can map it to NULL.
  assert.throws(() => prepareCompleteInsertRow(ctx, { title: "event", count: "" }), /invalid_integer/);
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
  assert.throws(() => buildSpreadsheetDeleteSql({ ...ctx, def: resolveSpreadsheetTableDef("videos", true) }, {id:"row-1"}, before), /physical_delete_requires_visibility_status/);
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


test("unmounted FK lookup plans preserve CURRENT dedup, 99-value chunks and bound values", async () => {
  const { buildSpreadsheetForeignKeyLookups, assertSpreadsheetForeignKeyLookup } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const fk = [{ column: "event_id", referencedTable: "events", referencedColumn: "id" }];
  const hostile = "x'); DELETE FROM events; --";
  const rows = [{ event_id: null }, { event_id: "" }, { event_id: hostile }, { event_id: hostile },
    ...Array.from({ length: 100 }, (_, i) => ({ event_id: "event-" + i }))];
  const plans = buildSpreadsheetForeignKeyLookups(fk, rows);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].binds.length, 99);
  assert.equal(plans[1].binds.length, 2);
  assert.equal(plans[0].binds[0], hostile);
  assert.equal(plans[0].statement.includes(hostile), false);
  assert.equal(plans[0].statement, 'SELECT "id" AS value FROM "events" WHERE "id" IN (' + Array(99).fill("?").join(", ") + ')');
  assert.doesNotThrow(() => assertSpreadsheetForeignKeyLookup(plans[1], plans[1].values.map(value => ({ value }))));
  assert.throws(() => assertSpreadsheetForeignKeyLookup(plans[0], [{ value: hostile }]), /foreign_key_violation/);
  assert.deepEqual(buildSpreadsheetForeignKeyLookups(fk, [{ event_id: null }, {event_id:""}]), []);
  assert.deepEqual(buildSpreadsheetForeignKeyLookups([], [{ event_id:"a" }]), []);
  assert.throws(
    () => buildSpreadsheetForeignKeyLookups([{ column:"event_id", referencedTable:"events; DROP TABLE videos", referencedColumn:"id" }], [{event_id:"a"}]),
    /unknown_column/,
  );
});


test("D1 FK preflight checks every bound chunk and fails closed on missing references", async () => {
  const { validateSpreadsheetForeignKeys } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const fk = [{ column: "event_id", referencedTable: "events", referencedColumn: "id" }];
  const sqls = [];
  const seen = [];
  const db = {
    prepare(sql) {
      sqls.push(sql);
      return {
        bind(...values) {
          seen.push(values);
          return { async all() { return { results: values.map(value => ({ value })) }; } };
        },
      };
    },
  };
  const rows = Array.from({ length: 101 }, (_, i) => ({ event_id: "event-" + i }));
  await assert.doesNotReject(() => validateSpreadsheetForeignKeys(db, fk, rows, 3));
  assert.equal(sqls.length, 2);
  assert.deepEqual(seen.map(a => a.length), [99, 2]);
  const missingDb = {
    prepare() {
      return { bind() { return { async all() { return { results: [] }; } }; } };
    },
  };
  await assert.rejects(() => validateSpreadsheetForeignKeys(missingDb, fk, [{ event_id: "missing" }], 3), /foreign_key_violation/);
  const failingDb = {
    prepare() {
      return { bind() { return { async all() { throw new Error("db_unavailable"); } }; } };
    },
  };
  await assert.rejects(() => validateSpreadsheetForeignKeys(failingDb, fk, [{ event_id: "x" }], 3), /db_unavailable/);
  await assert.doesNotReject(() => validateSpreadsheetForeignKeys(failingDb, fk, [{ event_id: null }], 3));
});


test("FK preflight fails closed above S3's three-query ceiling before opening D1", async () => {
  const { buildSpreadsheetForeignKeyLookups, validateSpreadsheetForeignKeys, SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const fk = [{ column: "event_id", referencedTable: "events", referencedColumn: "id" }];
  const rows = n => Array.from({ length: n }, (_, i) => ({ event_id: "event-" + i }));
  assert.equal(SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES, 3);
  assert.equal(buildSpreadsheetForeignKeyLookups(fk, rows(297)).length, 3);
  assert.throws(() => buildSpreadsheetForeignKeyLookups(fk, rows(298)), /batch_too_large/);
  let prepared = 0;
  const db = { prepare() { prepared++; throw Error("should not reach D1"); } };
  await assert.rejects(() => validateSpreadsheetForeignKeys(db, fk, rows(298), 3), /batch_too_large/);
  assert.equal(prepared, 0);
  assert.throws(() => buildSpreadsheetForeignKeyLookups([...fk, ...fk, ...fk, ...fk],
    [{ event_id: "event-0" }]), /batch_too_large/);
});


test("optimistic CAS rejects incomplete or undefined before-images rather than substituting NULL", async () => {
  const { buildSpreadsheetUpdateSql, buildSpreadsheetDeleteSql } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    primaryKeys: ["id"],
    columns,
    columnNames: ["id", "title"],
  };
  for (const before of [
    { id: "slot-1" },
    { id: "slot-1", title: undefined },
    { id: "slot-1", title: false },
  ]) {
    assert.throws(() => buildSpreadsheetUpdateSql(ctx, { id: "slot-1" }, before, { title: "new" }), /invalid_snapshot/);
    assert.throws(() => buildSpreadsheetDeleteSql(ctx, { id: "slot-1" }, before), /invalid_snapshot/);
  }
  assert.deepEqual(
    buildSpreadsheetDeleteSql(ctx, { id: "slot-1" }, { id: "slot-1", title: null }).binds,
    ["slot-1", "slot-1", null],
  );
});


test("FK preflight requires request-wide remaining S3 read budget before touching D1", async () => {
  const { buildSpreadsheetForeignKeyLookups, validateSpreadsheetForeignKeys } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const fk = [{ column: "event_id", referencedTable: "events", referencedColumn: "id" }];
  const rows = n => Array.from({ length: n }, (_, i) => ({ event_id: "e-" + i }));
  assert.equal(buildSpreadsheetForeignKeyLookups(fk, rows(99), 1).length, 1);
  assert.throws(() => buildSpreadsheetForeignKeyLookups(fk, rows(100), 1), /batch_too_large/);
  assert.throws(() => buildSpreadsheetForeignKeyLookups(fk, rows(1), 0), /batch_too_large/);
  for (const budget of [-1, 4, NaN, 1.5, undefined]) {
    if (budget === undefined) continue; // planner supports explicit no-budget legacy characterization; execution does not.
    assert.throws(() => buildSpreadsheetForeignKeyLookups(fk, rows(1), budget), /batch_too_large/);
  }
  let called = 0;
  const db = { prepare() { called++; throw Error("unexpected D1"); } };
  await assert.rejects(() => validateSpreadsheetForeignKeys(db, fk, rows(1), 0), /batch_too_large/);
  await assert.rejects(() => validateSpreadsheetForeignKeys(db, fk, rows(100), 1), /batch_too_large/);
  await assert.rejects(() => validateSpreadsheetForeignKeys(db, fk, rows(1), undefined), /batch_too_large/);
  assert.equal(called, 0);
  await assert.doesNotReject(() => validateSpreadsheetForeignKeys(db, fk, [{ event_id: null }], 0));
});


test("CURRENT UPDATE/DELETE snapshot pre-read binds PK, requires one S3 read and complete row", async () => {
  const { fetchSpreadsheetRawSnapshot } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    primaryKeys: ["id"],
    columns,
    columnNames: ["id", "title"],
  };
  const statements = [], binds = [];
  let returned = { id: "s-1", title: null };
  const db = {
    prepare(sql) {
      statements.push(sql);
      return { bind(...values) {
        binds.push(values);
        return { async first() { return returned; } };
      } };
    },
  };
  const got = await fetchSpreadsheetRawSnapshot(db, ctx, { id: "s-1" }, 1);
  assert.deepEqual(got, { id: "s-1", title: null });
  assert.deepEqual(statements, ['SELECT * FROM "slots" WHERE "id" = ? LIMIT 1']);
  assert.deepEqual(binds, [["s-1"]]);
  for (const budget of [0, -1, 4, 0.5, undefined]) {
    await assert.rejects(() => fetchSpreadsheetRawSnapshot(db, ctx, { id: "s-1" }, budget), /batch_too_large/);
  }
  assert.equal(statements.length, 1);
  await assert.rejects(() => fetchSpreadsheetRawSnapshot(db, ctx, {}, 1), /missing_primary_key/);
  returned = null;
  await assert.rejects(() => fetchSpreadsheetRawSnapshot(db, ctx, { id: "s-1" }, 1), /row_not_found/);
  returned = { id: "s-1" };
  await assert.rejects(() => fetchSpreadsheetRawSnapshot(db, ctx, { id: "s-1" }, 1), /invalid_snapshot/);
  returned = { id: "s-1", title: undefined };
  await assert.rejects(() => fetchSpreadsheetRawSnapshot(db, ctx, { id: "s-1" }, 1), /invalid_snapshot/);
});


test("unmounted INSERT and UPDATE SQL planners reject readonly tables before planning mutations", async () => {
  const { buildSpreadsheetInsertSql, buildSpreadsheetUpdateSql } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("system_settings", true),
    primaryKeys: ["id"],
    columnNames: ["id", "title"],
    columns,
  };
  assert.equal(ctx.def.mode, "readonly");
  assert.throws(
    () => buildSpreadsheetInsertSql(ctx, { id: "x", title: "new" }),
    error => error?.message === "table_readonly",
  );
  assert.throws(
    () => buildSpreadsheetUpdateSql(ctx, { id: "x" }, { id: "x", title: "old" }, { title: "new" }),
    error => error?.message === "table_readonly",
  );
  // Empty input must not bypass the table-level guard.
  assert.throws(() => buildSpreadsheetInsertSql(ctx, {}), /table_readonly/);
  assert.throws(
    () => buildSpreadsheetUpdateSql(ctx, { id: "x" }, { id: "x", title: "old" }, {}),
    /table_readonly/,
  );
});


test("SQLite executes bound INSERT/UPDATE/DELETE with optimistic CAS and does not execute user SQL", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { buildSpreadsheetInsertSql, buildSpreadsheetUpdateSql, buildSpreadsheetDeleteSql } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE slots (id TEXT PRIMARY KEY NOT NULL, title TEXT, count INTEGER)");
    const columns = [
      { name: "id", type: "TEXT", notNull: true, pk: 1 },
      { name: "title", type: "TEXT", notNull: false, pk: 0 },
      { name: "count", type: "INTEGER", notNull: false, pk: 0 },
    ];
    const ctx = {
      def: resolveSpreadsheetTableDef("slots", true),
      primaryKeys: ["id"],
      columns,
      columnNames: columns.map(c => c.name),
    };
    const hostile = "'); DROP TABLE slots; --";
    const inserted = buildSpreadsheetInsertSql(ctx, { id: "slot-1", title: hostile, count: "3" });
    assert.equal(db.prepare(inserted.statement).run(...inserted.binds).changes, 1);
    let before = db.prepare('SELECT * FROM slots WHERE id = ?').get("slot-1");
    assert.equal(before.title, hostile);
    assert.equal(before.count, 3);
    const update = buildSpreadsheetUpdateSql(ctx, { id: "slot-1" }, before, { title: "" });
    assert.equal(db.prepare(update.statement).run(...update.binds).changes, 1);
    assert.equal(db.prepare('SELECT title FROM slots WHERE id = ?').get("slot-1").title, null);
    // Simulate a concurrent writer between SELECT and UPDATE: optimistic CAS must reject it.
    db.prepare('UPDATE slots SET count = ? WHERE id = ?').run(4, "slot-1");
    const stale = buildSpreadsheetUpdateSql(ctx, { id: "slot-1" }, before, { title: "stale-write" });
    assert.equal(db.prepare(stale.statement).run(...stale.binds).changes, 0);
    assert.equal(db.prepare('SELECT count FROM slots WHERE id = ?').get("slot-1").count, 4);
    before = db.prepare('SELECT * FROM slots WHERE id = ?').get("slot-1");
    const removed = buildSpreadsheetDeleteSql(ctx, { id: "slot-1" }, before);
    assert.equal(db.prepare(removed.statement).run(...removed.binds).changes, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM slots').get().total, 0);
  } finally {
    db.close();
  }
});


test("unmounted audited SQL plans preserve CURRENT audit envelopes for CREATE UPDATE DELETE", async () => {
  const { buildSpreadsheetAuditedInsert, buildSpreadsheetAuditedUpdate, buildSpreadsheetAuditedDelete, spreadsheetRecordIdFromPk } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = { def: resolveSpreadsheetTableDef("slots", true), columns, columnNames: ["id", "title"], primaryKeys: ["id"] };
  const expected = { table_name: "slots", target_id: "slot-1", actor_user_id: "operator-1", retention_class: "long_audit", strict: true, context: "admin_spreadsheet" };
  const inserted = buildSpreadsheetAuditedInsert(ctx, { id: "slot-1", title: "hello" }, "operator-1");
  assert.deepEqual(inserted.audit, { ...expected, operation: "CREATE", before: null, after: { id: "slot-1", title: "hello" } });
  assert.match(inserted.statement, /^INSERT INTO /);
  const before = { id: "slot-1", title: "hello" };
  const updated = buildSpreadsheetAuditedUpdate(ctx, { id: "slot-1" }, before, { title: "" }, "operator-1");
  assert.deepEqual(updated.audit, { ...expected, operation: "UPDATE", before, after: { id: "slot-1", title: null } });
  assert.match(updated.statement, /^UPDATE /);
  assert.deepEqual(before, { id: "slot-1", title: "hello" });
  const deleted = buildSpreadsheetAuditedDelete(ctx, { id: "slot-1" }, before, "operator-1");
  assert.deepEqual(deleted.audit, { ...expected, operation: "DELETE", before, after: null });
  assert.match(deleted.statement, /^DELETE /);
  assert.equal(spreadsheetRecordIdFromPk({ video_id: "v1", event_id: "e1" }), "e1:v1");
  assert.throws(() => buildSpreadsheetAuditedInsert(ctx, { id: "slot-1" }, "  "), /missing_operator/);
});


test("UPDATE/DELETE audited CAS planners reject mismatched snapshot primary keys", async () => {
  const { buildSpreadsheetAuditedUpdate, buildSpreadsheetAuditedDelete } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
    { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("video_events", true),
    columns,
    columnNames: columns.map(c => c.name),
    primaryKeys: ["video_id", "event_id"],
  };
  const requested = { video_id: "v1", event_id: "e1" };
  const before = { video_id: "v1", event_id: "e1", notes: null };
  assert.equal(buildSpreadsheetAuditedUpdate(ctx, requested, before, { notes: "new" }, "actor").audit.target_id, "e1:v1");
  assert.equal(buildSpreadsheetAuditedDelete(ctx, requested, before, "actor").audit.target_id, "e1:v1");
  for (const wrong of [
    { ...before, video_id: "v2" },
    { ...before, event_id: "e2" },
    { ...before, event_id: null },
    { video_id: "v1", notes: null },
  ]) {
    assert.throws(() => buildSpreadsheetAuditedUpdate(ctx, requested, wrong, { notes: "new" }, "actor"), /invalid_snapshot/);
    assert.throws(() => buildSpreadsheetAuditedDelete(ctx, requested, wrong, "actor"), /invalid_snapshot/);
  }
});


test("FK planner stops scanning on first over-budget distinct input without DB access", async () => {
  const { buildSpreadsheetForeignKeyLookups, validateSpreadsheetForeignKeys } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const fk = [{ column: "event_id", referencedTable: "events", referencedColumn: "id" }];
  let reads = 0;
  const rows = [{ event_id: null }, ...Array.from({ length: 99 }, (_, i) => ({ event_id: "e-" + i }))];
  const poison = new Proxy({}, { get() { reads++; throw new Error("scanned_past_budget"); } });
  rows.push({ event_id: "over-budget" }, poison);
  assert.throws(() => buildSpreadsheetForeignKeyLookups(fk, rows, 1), /batch_too_large/);
  assert.equal(reads, 0);
  let prepared = 0;
  const db = { prepare() { prepared++; throw new Error("unexpected_d1"); } };
  await assert.rejects(() => validateSpreadsheetForeignKeys(db, fk, rows, 1), /batch_too_large/);
  assert.equal(prepared, 0);
  const duplicateRows = Array.from({ length: 1000 }, () => ({ event_id: "same" }));
  assert.deepEqual(buildSpreadsheetForeignKeyLookups(fk, duplicateRows, 1)[0].binds, ["same"]);
  assert.deepEqual(buildSpreadsheetForeignKeyLookups(fk, [{ event_id: null }], 0), []);
});


test("FK preflight executes bound SELECT on SQLite, accepting existing and rejecting missing references", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { validateSpreadsheetForeignKeys } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec('CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL)');
    sqlite.prepare('INSERT INTO events (id) VALUES (?)').run("e-1");
    sqlite.prepare('INSERT INTO events (id) VALUES (?)').run("e-2");
    const db = {
      prepare(sql) {
        return {
          bind(...values) {
            return { async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
          },
        };
      },
    };
    const foreignKeys = [{ column: "event_id", referencedTable: "events", referencedColumn: "id" }];
    await assert.doesNotReject(() =>
      validateSpreadsheetForeignKeys(db, foreignKeys, [{ event_id: "e-1" }, { event_id: "e-2" }, { event_id: "e-1" }], 1));
    await assert.rejects(() =>
      validateSpreadsheetForeignKeys(db, foreignKeys, [{ event_id: "e-1" }, { event_id: "missing" }], 1),
      /foreign_key_violation/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
  } finally {
    sqlite.close();
  }
});


test("CURRENT import preflight preserves row indices, duplicate PK errors and apply batch cap", async () => {
  const { prepareSpreadsheetImportMutationRows, SPREADSHEET_IMPORT_APPLY_MAX_ROWS, SPREADSHEET_IMPORT_PREVIEW_MAX_ROWS } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
    { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
    { name: "access_token", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("video_events", true),
    columns,
    columnNames: columns.map(c => c.name),
    primaryKeys: ["video_id", "event_id"],
  };
  assert.equal(SPREADSHEET_IMPORT_APPLY_MAX_ROWS, 7);
  assert.equal(SPREADSHEET_IMPORT_PREVIEW_MAX_ROWS, 500);
  const rows = [
    { video_id: "v1", event_id: "e1", notes: "a" },
    { video_id: "v1", event_id: "e1", notes: "duplicate" },
    { video_id: "v1", event_id: "e2", notes: null },
    { video_id: "v1", notes: "missing pk" },
    { video_id: "v2", event_id: "e1", access_token: "secret" },
    { video_id: "v3", event_id: "e1", invalid: "unknown" },
    { video_id: "v4", event_id: "e1", notes: "valid" },
  ];
  const result = prepareSpreadsheetImportMutationRows(ctx, rows);
  assert.deepEqual(result.errors, [
    { index: 1, message: "duplicate_primary_key" },
    { index: 3, message: "missing_primary_key" },
    { index: 4, message: "column_not_editable" },
    { index: 5, message: "unknown_column" },
  ]);
  assert.deepEqual(result.preparedRows.map(r => r.pk), [
    { video_id: "v1", event_id: "e1" },
    { video_id: "v1", event_id: "e2" },
    { video_id: "v4", event_id: "e1" },
  ]);
  assert.equal(result.preparedRows[0].fingerprint, JSON.stringify([["event_id", "e1"], ["video_id", "v1"]]));
  assert.throws(() => prepareSpreadsheetImportMutationRows(ctx, []), /batch_too_large/);
  assert.throws(() => prepareSpreadsheetImportMutationRows(ctx, Array.from({length: 8}, (_,i) => ({video_id: "v"+i, event_id:"e"}))), /batch_too_large/);
  assert.throws(() => prepareSpreadsheetImportMutationRows(ctx, Array.from({length: 501}, (_,i) => ({video_id:"v"+i,event_id:"e"}))), /too_many_rows/);
  assert.throws(() => prepareSpreadsheetImportMutationRows({ ...ctx, def: resolveSpreadsheetTableDef("system_settings", true) }, rows), /table_readonly/);
});


test("CURRENT import upsert planner counts INSERT UPDATE and skip without D1 effects", async () => {
  const { prepareSpreadsheetImportMutationRows, planSpreadsheetImportMutations } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
    { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("video_events", true),
    columns,
    columnNames: columns.map(c => c.name),
    primaryKeys: ["video_id", "event_id"],
  };
  const rows = [
    { video_id: "v1", event_id: "e1", notes: "new" },
    { video_id: "v2", event_id: "e1" },
    { video_id: "v3", event_id: "e1", notes: "inserted" },
  ];
  const prepared = prepareSpreadsheetImportMutationRows(ctx, rows);
  assert.deepEqual(prepared.errors, []);
  const existing = new Map([
    [prepared.preparedRows[0].fingerprint, { video_id: "v1", event_id: "e1", notes: "old" }],
    [prepared.preparedRows[1].fingerprint, { video_id: "v2", event_id: "e1", notes: "unchanged" }],
  ]);
  const planned = planSpreadsheetImportMutations(ctx, prepared, "upsert", existing, "actor-1");
  assert.deepEqual({ inserted: planned.inserted, updated: planned.updated, skipped: planned.skipped }, { inserted: 1, updated: 1, skipped: 1 });
  assert.deepEqual(planned.mutations.map(x => x.audit.operation), ["UPDATE", "CREATE"]);
  assert.deepEqual(planned.mutations[0].audit.after, { video_id: "v1", event_id: "e1", notes: "new" });
  assert.deepEqual(planned.mutations[1].audit.after, { video_id: "v3", event_id: "e1", notes: "inserted" });
  assert.equal(planSpreadsheetImportMutations(ctx, prepared, "insert", null, "actor-1").inserted, 3);
  assert.throws(() => planSpreadsheetImportMutations(ctx, prepared, "upsert", null, "actor-1"), /invalid_snapshot/);
  assert.throws(() => planSpreadsheetImportMutations(ctx, prepared, "upsert", existing, ""), /missing_operator/);
  assert.throws(() => planSpreadsheetImportMutations(ctx, { ...prepared, errors: [{ index: 1, message: "duplicate_primary_key" }] }, "insert", null, "actor-1"), /invalid_row/);
  assert.deepEqual(rows[0], { video_id: "v1", event_id: "e1", notes: "new" });
});


test("U02 preview token binds operator, table, schema and payload and rejects expiry or tampering", async () => {
  const { buildSpreadsheetImportPreviewBinding, issueSpreadsheetImportPreviewToken, verifySpreadsheetImportPreviewToken,
    requireSpreadsheetImportPreviewSecret, SPREADSHEET_IMPORT_PREVIEW_TTL_SECONDS } =
    await import("../src/routes/admin/spreadsheet/importPreviewToken.ts");
  const secret = "this-is-a-valid-test-preview-secret-of-40-chars";
  const input = {
    operatorUserId: "operator-1",
    table: "video_events",
    mode: "upsert",
    columns: ["video_id", "event_id", "notes"],
    primaryKeys: ["video_id", "event_id"],
    schemaColumns: [
      { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
      { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
      { name: "notes", type: "TEXT", notNull: false, pk: 0 },
    ],
    rows: [{ video_id: "v-1", event_id: "e-1", notes: "old" }],
  };
  const binding = await buildSpreadsheetImportPreviewBinding(input);
  const { token, claims } = await issueSpreadsheetImportPreviewToken(binding, secret, {
    now: 1800000000, nonce: "12345678-1234-4234-8234-123456789abc",
  });
  assert.equal(claims.expiresAt - claims.issuedAt, SPREADSHEET_IMPORT_PREVIEW_TTL_SECONDS);
  assert.equal((await verifySpreadsheetImportPreviewToken(token, secret, binding, { now: 1800000001 }))?.nonce, claims.nonce);
  assert.equal(await verifySpreadsheetImportPreviewToken(token, secret, { ...binding, operatorUserId: "operator-2" }, { now: 1800000001 }), null);
  assert.equal(await verifySpreadsheetImportPreviewToken(token, secret, { ...binding, mode: "insert" }, { now: 1800000001 }), null);
  const alteredPayload = await buildSpreadsheetImportPreviewBinding({ ...input, rows: [{ ...input.rows[0], notes: "altered" }] });
  assert.equal(await verifySpreadsheetImportPreviewToken(token, secret, alteredPayload, { now: 1800000001 }), null);
  assert.equal(await verifySpreadsheetImportPreviewToken(token, secret, binding, { now: claims.expiresAt }), null);
  const parts = token.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  const corrupted = parts.join(".");
  assert.equal(await verifySpreadsheetImportPreviewToken(corrupted, secret, binding, { now: 1800000001 }), null);
  assert.throws(() => requireSpreadsheetImportPreviewSecret("short"), /preview_unavailable/);
  await assert.rejects(() => issueSpreadsheetImportPreviewToken(binding, secret, { now: 1800000000, nonce: "invalid" }), /preview_unavailable/);
});


test("U02 nonce SQL enforces one-time, exact preview claims and expiry on real SQLite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { buildSpreadsheetPreviewNonceConsumeSql } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const claims = {
    version: 1,
    nonce: "12345678-1234-4234-8234-123456789abc",
    operatorUserId: "user-1", table: "video_events", mode: "insert",
    columns: ["video_id"], primaryKeys: ["video_id"],
    payloadHash: "a".repeat(64), schemaFingerprint: "b".repeat(64),
    issuedAt: 1000, expiresAt: 1300,
  };
  const db = new DatabaseSync(":memory:");
  try {
    db.exec('CREATE TABLE spreadsheet_import_runs (nonce TEXT PRIMARY KEY, operator_user_id TEXT NOT NULL, table_name TEXT NOT NULL, mode TEXT NOT NULL, payload_hash TEXT NOT NULL, schema_fingerprint TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL)');
    db.prepare('INSERT INTO spreadsheet_import_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      claims.nonce, claims.operatorUserId, claims.table, claims.mode, claims.payloadHash,
      claims.schemaFingerprint, claims.expiresAt, null, claims.issuedAt);
    const wrong = buildSpreadsheetPreviewNonceConsumeSql({ ...claims, payloadHash: "c".repeat(64) }, 1100);
    assert.equal(db.prepare(wrong.statement).run(...wrong.binds).changes, 0);
    const expired = buildSpreadsheetPreviewNonceConsumeSql(claims, 1301);
    assert.equal(db.prepare(expired.statement).run(...expired.binds).changes, 0);
    const plan = buildSpreadsheetPreviewNonceConsumeSql(claims, 1100);
    assert.equal(plan.audit.operation, "UPDATE");
    assert.equal(plan.audit.before.consumed_at, null);
    assert.equal(plan.audit.after.consumed_at, 1100);
    assert.equal(db.prepare(plan.statement).run(...plan.binds).changes, 1);
    assert.equal(db.prepare(plan.statement).run(...plan.binds).changes, 0);
    assert.equal(db.prepare('SELECT consumed_at FROM spreadsheet_import_runs').get().consumed_at, 1100);
    assert.throws(() => buildSpreadsheetPreviewNonceConsumeSql(claims, 999), /preview_required/);
  } finally {
    db.close();
  }
});


test("U02 CURRENT CSV/TSV import parses quoted cells, headers, unknown columns and NULL values", async () => {
  const { prepareSpreadsheetImportRows, assertSpreadsheetImportColumns } =
    await import("../src/routes/admin/spreadsheet/importPrepCore.ts");
  const columnNames = ["video_id", "event_id", "notes"];
  const csv = 'VIDEO_ID,event_id,notes\nv1,e1,"hello, ""world"""\nv2,e2,NULL\n';
  const parsed = prepareSpreadsheetImportRows({ text: csv, columnNames, hasHeader: true, delimiter: "auto" });
  assert.deepEqual(parsed.mappedColumns, columnNames);
  assert.deepEqual(parsed.rows, [
    { video_id: "v1", event_id: "e1", notes: 'hello, "world"' },
    { video_id: "v2", event_id: "e2", notes: null },
  ]);
  assert.deepEqual(parsed.invalidColumns, []);
  assert.doesNotThrow(() => assertSpreadsheetImportColumns({
    mappedColumns: parsed.mappedColumns, invalidColumns: [], columnNames, readonlyColumns: [],
  }));
  const tsv = prepareSpreadsheetImportRows({
    text: "video_id\tevent_id\tnotes\nv3\te3\ttext",
    columnNames, hasHeader: true, delimiter: "auto",
  });
  assert.deepEqual(tsv.rows, [{ video_id: "v3", event_id: "e3", notes: "text" }]);
  const invalid = prepareSpreadsheetImportRows({
    text: "video_id,unknown\nv1,oops", columnNames, hasHeader: true, delimiter: "csv",
  });
  assert.deepEqual(invalid.invalidColumns, ["unknown"]);
  assert.throws(() => assertSpreadsheetImportColumns({
    mappedColumns: invalid.mappedColumns, invalidColumns: invalid.invalidColumns, columnNames, readonlyColumns: [],
  }), /unknown_column:unknown/);
  assert.throws(() => assertSpreadsheetImportColumns({
    mappedColumns: ["notes"], invalidColumns: [], columnNames, readonlyColumns: ["notes"],
  }), /column_not_editable:notes/);
});

test("U02 CURRENT import applies 500-row preview ceiling and 2M-char payload limit", async () => {
  const { prepareSpreadsheetImportRows } = await import("../src/routes/admin/spreadsheet/importPrepCore.ts");
  const base = { columnNames: ["id"], hasHeader: true, delimiter: "csv" };
  assert.throws(() => prepareSpreadsheetImportRows({ ...base, text: "" }), /no_rows/);
  assert.throws(() => prepareSpreadsheetImportRows({ ...base, text: "x".repeat(2_000_001) }), /payload_too_large/);
  assert.throws(() => prepareSpreadsheetImportRows({ ...base, rows: Array.from({length: 501}, () => ({id:"x"})) }), /too_many_rows/);
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: "id-" + i }));
  assert.equal(prepareSpreadsheetImportRows({ ...base, rows }).rows.length, 500);
  const parsed = prepareSpreadsheetImportRows({ ...base, text: "id\n" + rows.map(row => row.id).join("\n") });
  assert.equal(parsed.rows.length, 500);
  assert.throws(() => prepareSpreadsheetImportRows({ ...base, text: "id\n" + rows.concat({id:"overflow"}).map(row => row.id).join("\n") }), /too_many_rows/);
});


test("U02 upsert existing-row lookup binds composite PKs in one D1 SELECT and rejects unexpected rows", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { prepareSpreadsheetImportMutationRows, fetchSpreadsheetExistingImportRows, planSpreadsheetImportMutations } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
    { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = { def: resolveSpreadsheetTableDef("video_events", true), columns,
    columnNames: columns.map(c => c.name), primaryKeys: ["video_id", "event_id"] };
  const rows = [{ video_id: "v1", event_id: "e1", notes: "changed" },
    { video_id: "v2", event_id: "e2", notes: "insert" }];
  const prepared = prepareSpreadsheetImportMutationRows(ctx, rows);
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec('CREATE TABLE video_events (video_id TEXT, event_id TEXT, notes TEXT, PRIMARY KEY (video_id, event_id))');
    sqlite.prepare('INSERT INTO video_events VALUES (?, ?, ?)').run("v1", "e1", "before");
    let reads = 0;
    let statement = "", values = [];
    const db = { prepare(sql) { reads++; statement = sql; return { bind(...binds) {
      values = binds;
      return { async all() { return { results: sqlite.prepare(sql).all(...binds) }; } };
    } }; } };
    const existing = await fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1);
    assert.equal(reads, 1);
    assert.equal(statement, 'SELECT * FROM "video_events" WHERE ("video_id" = ? AND "event_id" = ?) OR ("video_id" = ? AND "event_id" = ?) LIMIT 8');
    assert.deepEqual(values, ["v1", "e1", "v2", "e2"]);
    assert.deepEqual([...existing.keys()], [JSON.stringify([["event_id", "e1"], ["video_id", "v1"]])]);
    const planned = planSpreadsheetImportMutations(ctx, prepared, "upsert", existing, "operator");
    assert.deepEqual({ inserted: planned.inserted, updated: planned.updated, skipped: planned.skipped },
      { inserted: 1, updated: 1, skipped: 0 });
    await assert.rejects(() => fetchSpreadsheetExistingImportRows(db, ctx, prepared, 0), /batch_too_large/);
    assert.equal(reads, 1);
    const extraDb = { prepare() { return { bind() { return { async all() { return { results: [
      { video_id: "different", event_id: "id", notes: "wrong" },
    ] }; } }; } }; } };
    await assert.rejects(() => fetchSpreadsheetExistingImportRows(extraDb, ctx, prepared, 1), /invalid_snapshot/);
    await assert.rejects(() => fetchSpreadsheetExistingImportRows(db, ctx, { ...prepared, errors: [
      { index: 0, message: "invalid_row" },
    ] }, 1), /invalid_row/);
  } finally {
    sqlite.close();
  }
});



test("MIG-0638: embedded NUL input fails closed before D1 binds can truncate values", async () => {
  const {
    normalizeSpreadsheetPrimaryKey, prepareSpreadsheetImportMutationRows,
    fetchSpreadsheetExistingImportRows,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
    { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("video_events", true),
    columns,
    columnNames: columns.map(column => column.name),
    primaryKeys: ["video_id", "event_id"],
  };
  // The old NUL-separated fingerprint could not distinguish these PKs.
  const pairA = { video_id: "a\0b", event_id: "c", notes: "first" };
  const pairB = { video_id: "b", event_id: "c\0a", notes: "second" };
  assert.equal(["c", "a\0b"].join("\0"), ["c\0a", "b"].join("\0"));
  assert.throws(() => normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, pairA), /invalid_row/);
  assert.throws(() => validateSpreadsheetInputValues(ctx, { notes: "visible\0lost" }), /invalid_row/);
  const prepared = prepareSpreadsheetImportMutationRows(ctx, [pairA, pairB]);
  assert.deepEqual(prepared.errors, [
    { index: 0, message: "invalid_row" },
    { index: 1, message: "invalid_row" },
  ]);
  assert.equal(prepared.preparedRows.length, 0);
  let reads = 0;
  const db = { prepare() { reads++; throw new Error("DB must not be read"); } };
  await assert.rejects(() => fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1), /invalid_row/);
  assert.equal(reads, 0, "invalid NUL PK must never reach the D1 binding");
});

test("MIG-0638: distinct normal composite keys retain 1-D1-read UPSERT before-images", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const {
    prepareSpreadsheetImportMutationRows, fetchSpreadsheetExistingImportRows,
    planSpreadsheetImportMutations,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "video_id", type: "TEXT", notNull: true, pk: 1 },
    { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("video_events", true), columns,
    columnNames: columns.map(column => column.name),
    primaryKeys: ["video_id", "event_id"],
  };
  const rows = [
    { video_id: "a-b", event_id: "c", notes: "new-a" },
    { video_id: "b", event_id: "c-a", notes: "new-b" },
  ];
  const prepared = prepareSpreadsheetImportMutationRows(ctx, rows);
  assert.deepEqual(prepared.errors, []);
  assert.equal(prepared.preparedRows.length, 2);
  const [keyA, keyB] = prepared.preparedRows.map(x => x.fingerprint);
  assert.notEqual(keyA, keyB);
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("CREATE TABLE video_events (video_id TEXT, event_id TEXT, notes TEXT, PRIMARY KEY (video_id, event_id))");
    sqlite.prepare("INSERT INTO video_events VALUES (?, ?, ?)").run("a-b", "c", "old-a");
    sqlite.prepare("INSERT INTO video_events VALUES (?, ?, ?)").run("b", "c-a", "old-b");
    let reads = 0;
    const db = {
      prepare(sql) {
        reads++;
        return { bind(...values) {
          return { async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
        } };
      },
    };
    const existing = await fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1);
    assert.equal(reads, 1);
    assert.equal(existing.size, 2);
    assert.equal(existing.get(keyA)?.notes, "old-a");
    assert.equal(existing.get(keyB)?.notes, "old-b");
    const planned = planSpreadsheetImportMutations(ctx, prepared, "upsert", existing, "operator-1");
    assert.deepEqual([planned.inserted, planned.updated, planned.skipped], [0, 2, 0]);
    assert.equal(planned.mutations.length, 2);
    assert.equal(planned.mutations[0].audit.before.notes, "old-a");
    assert.equal(planned.mutations[1].audit.before.notes, "old-b");
    assert.equal(planned.mutations[0].audit.after.notes, "new-a");
    assert.equal(planned.mutations[1].audit.after.notes, "new-b");
  } finally {
    sqlite.close();
  }
});


test("Hono import composite PK identity is canonical for distinct Unicode-normalized column names", () => {
  const composed = "\u00e9";
  const decomposed = "e\u0301";
  const first = { [composed]: "one", [decomposed]: "two" };
  const reversed = { [decomposed]: "two", [composed]: "one" };
  assert.equal(spreadsheetImportPrimaryKeyFingerprint(first), spreadsheetImportPrimaryKeyFingerprint(reversed));
  assert.notEqual(
    spreadsheetImportPrimaryKeyFingerprint(first),
    spreadsheetImportPrimaryKeyFingerprint({ [composed]: "one", [decomposed]: "changed" }),
  );
});


test("MIG-0638: direct FK preflight rejects NUL-bearing values before any D1 query", async () => {
  const { buildSpreadsheetForeignKeyLookups, validateSpreadsheetForeignKeys } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const fks = [{ column: "event_id", referencedTable: "events", referencedColumn: "id" }];
  for (const bad of ["a\0b", "\0", "normal\0suffix"]) {
    assert.throws(
      () => buildSpreadsheetForeignKeyLookups(fks, [{ event_id: bad }], 3),
      (error) => error instanceof Error && error.message === "invalid_row",
      "no NUL-containing FK should be sent as a bound SQLite text parameter",
    );
    let prepares = 0;
    const db = { prepare() { prepares++; throw new Error("Unexpected D1 read"); } };
    await assert.rejects(
      () => validateSpreadsheetForeignKeys(db, fks, [{ event_id: bad }], 3),
      (error) => error instanceof Error && error.message === "invalid_row",
    );
    assert.equal(prepares, 0, "invalid foreign key must fail before opening D1");
  }
  const normal = buildSpreadsheetForeignKeyLookups(fks, [{ event_id: "valid-id" }], 3);
  assert.equal(normal.length, 1);
  assert.deepEqual(normal[0].binds, ["valid-id"]);
});


test("MIG-0638: merged CURRENT #671 primary key contracts equal unmounted Hono helpers", async () => {
  const current = await import("../../../src/lib/admin/spreadsheet/validation.ts");
  const target = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const outcome = fn => {
    try { return { ok: true, result: fn() }; }
    catch (error) { return { ok: false, code: error instanceof Error ? error.message : String(error) }; }
  };
  for (const [keys, pk] of [
    [[], {}],
    [["id"], {}],
    [["id"], { id: "  " }],
    [["id"], { id: "value\0truncated" }],
    [["id", "event"], { id: "normal", event: "e:1" }],
    [["id", "event"], { event: "e:1", id: "normal" }],
  ]) {
    assert.deepEqual(
      outcome(() => target.normalizeSpreadsheetPrimaryKey(keys, pk)),
      outcome(() => current.normalizePrimaryKeyRecord(keys, pk)),
      "CURRENT and Hono must return identical PK normalization or error code",
    );
  }
  for (const row of [
    { id: "normal", event: "e:1" },
    { id: "nul\0key", event: "e:1" },
    { id: "", event: "e:1" },
  ]) {
    assert.deepEqual(
      outcome(() => target.primaryKeyFromSpreadsheetRow(row, ["id", "event"])),
      outcome(() => current.primaryKeyFromRowValues(row, ["id", "event"])),
    );
  }
  for (const pk of [
    { b: "y:z", a: "x" },
    { a: "x:y", b: "z" },
    { "\u00e9": "one", "e\u0301": "two" },
    { "e\u0301": "two", "\u00e9": "one" },
  ]) {
    assert.equal(
      target.spreadsheetImportPrimaryKeyFingerprint(pk),
      current.primaryKeyFingerprint(pk),
      "column identities and value boundaries must survive code-unit sorting",
    );
  }
});


test("MIG-0638 U02: CURRENT and Hono import preview tokens are cross-verifiable", async () => {
  const current = await import("../../../src/lib/admin/spreadsheet/importPreviewToken.ts");
  const hono = await import("../src/routes/admin/spreadsheet/importPreviewToken.ts");
  const secret = "preview-test-secret-longer-than-thirty-two-chars";
  const input = {
    operatorUserId: "operator-cross-runtime",
    table: "video_events",
    mode: "upsert",
    columns: ["event_id", "video_id", "notes"],
    primaryKeys: ["video_id", "event_id"],
    schemaColumns: [
      { name: "video_id", type: "TEXT", notNull: true, pk: 1, enumValues: ["b", "a"] },
      { name: "event_id", type: "TEXT", notNull: true, pk: 2 },
      { name: "notes", type: "TEXT", notNull: false, pk: 0, defaultValue: null },
    ],
    rows: [
      { video_id: "video:x", event_id: "event:y", notes: "a:b" },
      { notes: null, event_id: "other", video_id: "video:2" },
    ],
  };
  const a = await current.buildSpreadsheetImportPreviewBinding(input);
  const b = await hono.buildSpreadsheetImportPreviewBinding(input);
  assert.deepEqual(b, a, "schema and payload hashes must match actual CURRENT");
  const options = { now: 1800000000, nonce: "12345678-1234-4234-8234-123456789abc" };
  const issuedCurrent = await current.issueSpreadsheetImportPreviewToken(a, secret, options);
  const issuedHono = await hono.issueSpreadsheetImportPreviewToken(b, secret, options);
  assert.equal(issuedHono.token, issuedCurrent.token, "signed tokens must be byte-identical");
  assert.deepEqual(issuedHono.claims, issuedCurrent.claims);
  assert.deepEqual(
    await hono.verifySpreadsheetImportPreviewToken(issuedCurrent.token, secret, b, { now: options.now + 1 }),
    issuedCurrent.claims,
    "Hono must accept CURRENT-issued preview token",
  );
  assert.deepEqual(
    await current.verifySpreadsheetImportPreviewToken(issuedHono.token, secret, a, { now: options.now + 1 }),
    issuedHono.claims,
    "CURRENT must accept Hono-issued preview token",
  );
  const changedRows = await hono.buildSpreadsheetImportPreviewBinding({
    ...input, rows: [{ ...input.rows[0], notes: "modified" }, input.rows[1]],
  });
  assert.equal(await current.verifySpreadsheetImportPreviewToken(issuedHono.token, secret, changedRows, { now: options.now + 1 }), null);
  assert.equal(await hono.verifySpreadsheetImportPreviewToken(issuedCurrent.token, secret, b, { now: options.now + 300 }), null);
});


test("MIG-0638 U01b: D1 100-bind limit on spreadsheet write plans fails closed at 101", async () => {
  const {
    SPREADSHEET_SQL_MAX_BINDS, buildSpreadsheetInsertSql, buildSpreadsheetUpdateSql,
    buildSpreadsheetDeleteSql,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  assert.equal(SPREADSHEET_SQL_MAX_BINDS, 100);
  const makeContext = (count) => {
    const columns = [
      { name: "id", type: "TEXT", notNull: true, pk: 1 },
      ...Array.from({ length: count - 1 }, (_, i) => ({
        name: "data_" + i, type: "TEXT", notNull: false, pk: 0,
      })),
    ];
    return {
      def: resolveSpreadsheetTableDef("slots", true),
      columns, columnNames: columns.map(c => c.name), primaryKeys: ["id"],
    };
  };
  const fullRow = (ctx) => Object.fromEntries(ctx.columns.map(c => [c.name, "value"]));
  const pk = { id: "value" };

  const insert100 = makeContext(100);
  assert.equal(buildSpreadsheetInsertSql(insert100, fullRow(insert100)).binds.length, 100);
  const insert101 = makeContext(101);
  assert.throws(() => buildSpreadsheetInsertSql(insert101, fullRow(insert101)), /batch_too_large/);

  // UPDATE: one SET bind + one PK bind + the entire row snapshot.
  const update98 = makeContext(98);
  assert.equal(buildSpreadsheetUpdateSql(update98, pk, fullRow(update98),
    { data_0: "new" }).binds.length, 100);
  const update99 = makeContext(99);
  assert.throws(() => buildSpreadsheetUpdateSql(update99, pk, fullRow(update99),
    { data_0: "new" }), /batch_too_large/);

  // DELETE: one PK bind plus all snapshot columns.
  const delete99 = makeContext(99);
  assert.equal(buildSpreadsheetDeleteSql(delete99, pk, fullRow(delete99)).binds.length, 100);
  const delete100 = makeContext(100);
  assert.throws(() => buildSpreadsheetDeleteSql(delete100, pk, fullRow(delete100)),
    /batch_too_large/);
});

test("MIG-0638 U01b: multi-column PK pre-reads reject >100 binds before D1 access", async () => {
  const {
    fetchSpreadsheetRawSnapshot, fetchSpreadsheetExistingImportRows,
    spreadsheetImportPrimaryKeyFingerprint,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  let prepares = 0;
  const db = {
    prepare() {
      prepares += 1;
      return {
        bind() {
          return {
            async first() { return null; },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  const ctx = (width) => {
    const columns = Array.from({ length: width }, (_, i) => ({
      name: "key_" + i, type: "TEXT", notNull: true, pk: i + 1,
    }));
    return {
      def: resolveSpreadsheetTableDef("slots", true),
      columns, columnNames: columns.map(c => c.name),
      primaryKeys: columns.map(c => c.name),
    };
  };
  const pk = (width, row) => Object.fromEntries(
    Array.from({ length: width }, (_, i) => ["key_" + i, "v" + row + "-" + i]),
  );
  const prepared = (width) => ({
    errors: [],
    preparedRows: Array.from({ length: 7 }, (_, i) => {
      const key = pk(width, i);
      return { pk: key, row: key, fingerprint: spreadsheetImportPrimaryKeyFingerprint(key) };
    }),
  });

  const width14 = ctx(14);
  const existing = await fetchSpreadsheetExistingImportRows(db, width14, prepared(14), 1);
  assert.equal(existing.size, 0);
  assert.equal(prepares, 1, "7 x 14 = 98 binds is allowed");

  const width15 = ctx(15);
  await assert.rejects(
    fetchSpreadsheetExistingImportRows(db, width15, prepared(15), 1),
    /batch_too_large/,
  );
  assert.equal(prepares, 1, "7 x 15 = 105 must not call D1");
  await assert.rejects(fetchSpreadsheetRawSnapshot(db, ctx(101), pk(101, 0), 1),
    /batch_too_large/);
  assert.equal(prepares, 1, "single snapshot read at 101 binds must not call D1");
  await assert.rejects(fetchSpreadsheetRawSnapshot(db, ctx(100), pk(100, 0), 1),
    /row_not_found/);
  assert.equal(prepares, 2, "single snapshot read at 100 binds must reach D1");
});


test("MIG-0638 U01b: snapshot lookup does not mistake a secret primary key for a forbidden cell mutation", async () => {
  const {
    fetchSpreadsheetRawSnapshot, normalizeSpreadsheetPrimaryKey,
    validateSpreadsheetInputValues,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "access_token", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    primaryKeys: ["access_token"],
    columns, columnNames: columns.map(column => column.name),
  };
  const pk = { access_token: "secret-PK-1" };
  // CURRENT normalizes and binds PK values without imposing cell editability.
  assert.deepEqual(normalizeSpreadsheetPrimaryKey(ctx.primaryKeys, pk), pk);
  assert.throws(() => validateSpreadsheetInputValues(ctx, pk), /column_not_editable/,
    "editable-cell policy is intentionally stricter than row identity lookup");

  let calls = 0;
  const db = {
    prepare(sql) {
      calls += 1;
      assert.equal(sql, 'SELECT * FROM "slots" WHERE "access_token" = ? LIMIT 1');
      return {
        bind(...args) {
          assert.deepEqual(args, ["secret-PK-1"]);
          return {
            async first() {
              return { access_token: "secret-PK-1", title: "original" };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(await fetchSpreadsheetRawSnapshot(db, ctx, pk, 1), {
    access_token: "secret-PK-1", title: "original",
  });
  assert.equal(calls, 1);
  await assert.rejects(
    fetchSpreadsheetRawSnapshot(db, ctx, { access_token: "bad\u0000pk" }, 1),
    /invalid_row/,
  );
  assert.equal(calls, 1, "invalid PK must be rejected before D1 reads");
});


test("MIG-0638 U01b: prototype-named SQL columns require own properties and preserve row identity", async () => {
  const {
    normalizeSpreadsheetPrimaryKey, primaryKeyFromSpreadsheetRow,
    prepareCompleteInsertRow, prepareSpreadsheetUpdate, buildSpreadsheetUpdateSql,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");

  for (const name of ["constructor", "toString", "__proto__"]) {
    // These are legal quoted SQL identifier spellings and inherited JS keys.
    assert.throws(() => normalizeSpreadsheetPrimaryKey([name], {}),
      /missing_primary_key/, "a prototype property cannot supply a missing PK");
    assert.throws(() => primaryKeyFromSpreadsheetRow({}, [name]),
      /missing_primary_key/, "a prototype property cannot supply an import-row PK");
    const explicit = Object.fromEntries([[name, "pk-value"]]);
    const normalized = normalizeSpreadsheetPrimaryKey([name], explicit);
    assert.deepEqual(normalized, explicit);
    assert.deepEqual(primaryKeyFromSpreadsheetRow(explicit, [name]), explicit);
    assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
    assert.ok(Object.hasOwn(normalized, name));

    const requiredColumns = [
      { name, type: "TEXT", notNull: true, pk: 1 },
      { name: "title", type: "TEXT", notNull: false, pk: 0 },
    ];
    const requiredCtx = {
      def: resolveSpreadsheetTableDef("slots", true),
      columns: requiredColumns, columnNames: requiredColumns.map(x => x.name),
      primaryKeys: [name],
    };
    assert.throws(() => prepareCompleteInsertRow(requiredCtx, { title: "x" }),
      /missing_required_column/, "missing prototype-named column cannot appear supplied");
    const inserted = prepareCompleteInsertRow(requiredCtx, explicit);
    assert.equal(inserted[name], "pk-value");
    assert.equal(Object.getPrototypeOf(inserted), Object.prototype);
    assert.ok(Object.hasOwn(inserted, name));

    // A prototype-named non-PK column must be editable only when present
    // explicitly, and "__proto__" must remain a data field in the after-image.
    const editableColumns = [
      { name: "id", type: "TEXT", notNull: true, pk: 1 },
      { name, type: "TEXT", notNull: false, pk: 0 },
    ];
    const editCtx = {
      def: resolveSpreadsheetTableDef("slots", true),
      columns: editableColumns, columnNames: editableColumns.map(x => x.name),
      primaryKeys: ["id"],
    };
    const before = Object.fromEntries([["id", "x"], [name, "old"]]);
    assert.throws(() => prepareSpreadsheetUpdate(editCtx, before, {}),
      /empty_row/, "empty input cannot implicitly edit inherited properties");
    const updated = prepareSpreadsheetUpdate(editCtx, before,
      Object.fromEntries([[name, "new"]]));
    assert.deepEqual(updated.setColumns, [name]);
    assert.equal(updated.after[name], "new");
    assert.equal(before[name], "old", "input snapshot remains unchanged");
    assert.equal(Object.getPrototypeOf(updated.after), Object.prototype);
    assert.ok(Object.hasOwn(updated.after, name));
    const sql = buildSpreadsheetUpdateSql(editCtx, { id: "x" }, before,
      Object.fromEntries([[name, "new"]]));
    assert.match(sql.statement, new RegExp('^UPDATE "slots" SET "' + name +
      '" = \\? WHERE "id" = \\? AND'));
    assert.equal(sql.binds[0], "new");
  }
});


test("MIG-0638 U02: import preflight snapshots mutable inputs before upsert planning", async () => {
  const {
    prepareSpreadsheetImportMutationRows, planSpreadsheetImportMutations,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(c => c.name),
    primaryKeys: ["id"],
  };
  let getterReads = 0;
  const row = {
    id: "slot-1",
    get title() {
      getterReads++;
      return getterReads === 1 ? "approved" : "tampered";
    },
  };
  const prepared = prepareSpreadsheetImportMutationRows(ctx, [row]);
  assert.deepEqual(prepared.errors, []);
  assert.equal(getterReads, 1, "a getter must not supply different validation and SQL values");
  assert.equal(prepared.preparedRows[0].row.title, "approved");
  assert.ok(Object.isFrozen(prepared.preparedRows[0].row));
  assert.ok(Object.isFrozen(prepared.preparedRows[0].pk));
  assert.ok(Object.isFrozen(prepared.preparedRows[0]));
  row.id = "slot-evil";
  Object.defineProperty(row, "title", { value: "evil", configurable: true });
  const planned = planSpreadsheetImportMutations(ctx, prepared, "insert", null, "operator");
  assert.equal(planned.inserted, 1);
  assert.deepEqual(planned.mutations[0].binds, ["slot-1", "approved"]);
  assert.equal(planned.mutations[0].audit.target_id, "slot-1");
  assert.equal(planned.mutations[0].audit.after.title, "approved");
  assert.equal(planned.mutations[0].audit.after.id, "slot-1");

  const malformed = prepareSpreadsheetImportMutationRows(ctx, [
    { id: "good", title: "ok" }, null,
  ]);
  assert.equal(malformed.preparedRows.length, 1);
  assert.deepEqual(malformed.errors.map(error => error.index), [1],
    "a malformed row must preserve per-row error indexing");
});

test("MIG-0638 U02: absent prototype-named UPSERT fields are skipped, not inherited", async () => {
  const {
    prepareSpreadsheetImportMutationRows, planSpreadsheetImportMutations,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "constructor", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(c => c.name),
    primaryKeys: ["id"],
  };
  const prepared = prepareSpreadsheetImportMutationRows(ctx, [{ id: "slot-1" }]);
  assert.deepEqual(prepared.errors, []);
  const existing = new Map([[prepared.preparedRows[0].fingerprint,
    Object.fromEntries([["id", "slot-1"], ["constructor", "existing"]])]]);
  const skipped = planSpreadsheetImportMutations(ctx, prepared, "upsert", existing, "operator");
  assert.deepEqual([skipped.inserted, skipped.updated, skipped.skipped], [0, 0, 1]);
  assert.deepEqual(skipped.mutations, []);

  const modified = prepareSpreadsheetImportMutationRows(ctx,
    [Object.fromEntries([["id", "slot-1"], ["constructor", "updated"]])]);
  const changed = planSpreadsheetImportMutations(ctx, modified, "upsert", existing, "operator");
  assert.deepEqual([changed.inserted, changed.updated, changed.skipped], [0, 1, 0]);
  assert.equal(changed.mutations[0].audit.after.constructor, "updated");
});

test("MIG-0638 U02: import existing-row D1 PK must be an own field", async () => {
  const {
    prepareSpreadsheetImportMutationRows, fetchSpreadsheetExistingImportRows,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "__proto__", type: "TEXT", notNull: true, pk: 1 },
    { name: "notes", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(c => c.name),
    primaryKeys: ["__proto__"],
  };
  const input = Object.fromEntries([["__proto__", "real-pk"], ["notes", "new"]]);
  const prepared = prepareSpreadsheetImportMutationRows(ctx, [input]);
  assert.deepEqual(prepared.errors, []);
  const fakeDB = rows => ({
    prepare(sql) {
      assert.match(sql, /^SELECT \* FROM "slots"/);
      return {
        bind(...values) {
          assert.deepEqual(values, ["real-pk"]);
          return { async all() { return { results: rows }; } };
        },
      };
    },
  });
  const validRow = Object.fromEntries([["__proto__", "real-pk"], ["notes", "old"]]);
  const found = await fetchSpreadsheetExistingImportRows(fakeDB([validRow]),
    ctx, prepared, 1);
  assert.equal(found.size, 1);
  assert.equal(found.get(prepared.preparedRows[0].fingerprint).notes, "old");
  await assert.rejects(fetchSpreadsheetExistingImportRows(
    fakeDB([{ notes: "old" }]), ctx, prepared, 1), /invalid_snapshot/,
    "an inherited Object.prototype value must not stand in for a DB PK");
});


test("MIG-0638 U02: D1 existing import rows are captured once before PK and audit planning", async () => {
  const {
    prepareSpreadsheetImportMutationRows, fetchSpreadsheetExistingImportRows,
    planSpreadsheetImportMutations,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(column => column.name),
    primaryKeys: ["id"],
  };
  const prepared = prepareSpreadsheetImportMutationRows(ctx,
    [{ id: "slot-1", title: "new title" }]);
  assert.deepEqual(prepared.errors, []);

  let pkReads = 0, titleReads = 0;
  const row = Object.defineProperties({}, {
    id: { enumerable: true, configurable: true, get() {
      pkReads++;
      return pkReads === 1 ? "slot-1" : "different-key";
    } },
    title: { enumerable: true, configurable: true, get() {
      titleReads++;
      return titleReads === 1 ? "before title" : "changed after read";
    } },
  });
  let selects = 0;
  const db = {
    prepare(sql) {
      selects++;
      assert.equal(sql, 'SELECT * FROM "slots" WHERE ("id" = ?) LIMIT 8');
      return { bind(...args) {
        assert.deepEqual(args, ["slot-1"]);
        return { async all() { return { results: [row] }; } };
      } };
    },
  };
  const found = await fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1);
  const key = prepared.preparedRows[0].fingerprint;
  const before = found.get(key);
  assert.equal(selects, 1);
  assert.equal(pkReads, 1, "PK getter must not change between lookup and audit");
  assert.equal(titleReads, 1, "before-image must be a single consistent snapshot");
  assert.deepEqual(before, { id: "slot-1", title: "before title" });
  assert.ok(Object.isFrozen(before));
  Object.defineProperty(row, "id", { configurable: true, value: "replaced" });
  Object.defineProperty(row, "title", { configurable: true, value: "tampered" });
  assert.equal(before.id, "slot-1");
  assert.equal(before.title, "before title");

  const planned = planSpreadsheetImportMutations(ctx, prepared, "upsert", found, "operator");
  assert.deepEqual([planned.inserted, planned.updated, planned.skipped], [0, 1, 0]);
  assert.deepEqual(planned.mutations[0].audit.before,
    { id: "slot-1", title: "before title" });
  assert.deepEqual(planned.mutations[0].audit.after,
    { id: "slot-1", title: "new title" });
  assert.deepEqual(planned.mutations[0].binds,
    ["new title", "slot-1", "slot-1", "before title"]);
  assert.equal(pkReads, 1);
  assert.equal(titleReads, 1);
});

test("MIG-0638 U02: throwing D1 snapshot accessors fail as invalid_snapshot", async () => {
  const {
    prepareSpreadsheetImportMutationRows, fetchSpreadsheetExistingImportRows,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(column => column.name),
    primaryKeys: ["id"],
  };
  const prepared = prepareSpreadsheetImportMutationRows(ctx,
    [{ id: "slot-1", title: "new" }]);
  const badRows = [
    Object.defineProperty({ id: "slot-1" }, "title", {
      enumerable: true, get() { throw Error("bad getter"); },
    }),
    Object.defineProperty({ title: "old" }, "id", {
      enumerable: true, get() { throw Error("secret leaked"); },
    }),
    { id: "slot-1" },
    null,
    ["slot-1", "old"],
  ];
  for (const bad of badRows) {
    const db = { prepare() { return { bind() {
      return { async all() { return { results: [bad] }; } };
    } }; } };
    await assert.rejects(
      fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1),
      error => error instanceof Error && error.message === "invalid_snapshot",
    );
  }
});


test("MIG-0638 U02: existing import PK read stays within 8 D1 rows and fails closed on schema drift", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const {
    MAX_SPREADSHEET_IMPORT_EXISTING_RESULT_ROWS,
    SPREADSHEET_IMPORT_APPLY_MAX_ROWS,
    prepareSpreadsheetImportMutationRows, fetchSpreadsheetExistingImportRows,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  assert.equal(SPREADSHEET_IMPORT_APPLY_MAX_ROWS, 7);
  assert.equal(MAX_SPREADSHEET_IMPORT_EXISTING_RESULT_ROWS, 8);
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(x => x.name),
    primaryKeys: ["id"],
  };
  const prepared = prepareSpreadsheetImportMutationRows(ctx, [{ id: "k", title: "new" }]);
  assert.deepEqual(prepared.errors, []);
  const sqlite = new DatabaseSync(":memory:");
  try {
    // Deliberately model broken schema metadata with no actual UNIQUE/PK index.
    // The unmounted Hono planner must refuse duplicates before audit/DB mutation.
    sqlite.exec('CREATE TABLE slots (id TEXT NOT NULL, title TEXT)');
    const insert = sqlite.prepare('INSERT INTO slots (id, title) VALUES (?, ?)');
    for (let i = 0; i < 20; i++) insert.run("k", "old-" + i);
    let observedSql = "", reads = 0, returnedRows = 0;
    const db = {
      prepare(sql) {
        reads++;
        observedSql = sql;
        return { bind(...binds) {
          return { async all() {
            const results = sqlite.prepare(sql).all(...binds);
            returnedRows = results.length;
            return { results };
          } };
        } };
      },
    };
    await assert.rejects(fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1),
      /invalid_snapshot/);
    assert.equal(reads, 1);
    assert.equal(observedSql, 'SELECT * FROM "slots" WHERE ("id" = ?) LIMIT 8');
    assert.equal(returnedRows, 8, "D1 must never materialize the remaining duplicate rows");
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM slots').get().n, 20,
      "preflight must not mutate persisted rows");

    // A one-to-one PK lookup remains supported without extra bind variables.
    sqlite.exec('DELETE FROM slots');
    insert.run("k", "only");
    const found = await fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1);
    assert.equal(found.get(prepared.preparedRows[0].fingerprint)?.title, "only");
    assert.equal(returnedRows, 1);
  } finally {
    sqlite.close();
  }
});

test("MIG-0638 U02: anomalous D1 result counts fail before building partial PK maps", async () => {
  const { fetchSpreadsheetExistingImportRows } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true), columns,
    columnNames: columns.map(x => x.name), primaryKeys: ["id"],
  };
  const prepared = {
    errors: [], preparedRows: [
      { pk: { id: "k" }, row: { id: "k", title: "new" }, fingerprint: '[["id","k"]]' },
    ],
  };
  const extra = Array.from({ length: 8 }, () => ({ id: "k", title: "old" }));
  const db = values => ({
    prepare(sql) {
      assert.match(sql, / LIMIT 8$/);
      return { bind() { return { async all() { return { results: values }; } }; } };
    },
  });
  await assert.rejects(fetchSpreadsheetExistingImportRows(db(extra), ctx, prepared, 1),
    /invalid_snapshot/);
  await assert.rejects(fetchSpreadsheetExistingImportRows(db({ results: extra }), ctx, prepared, 1),
    /invalid_snapshot/);
});


test("MIG-0638 U02: forged import PK fingerprints cannot select unrelated audit snapshots", async () => {
  const {
    prepareSpreadsheetImportMutationRows, planSpreadsheetImportMutations,
    fetchSpreadsheetExistingImportRows, spreadsheetImportPrimaryKeyFingerprint,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(c => c.name),
    primaryKeys: ["id"],
  };
  const prepared = prepareSpreadsheetImportMutationRows(ctx, [
    { id: "left", title: "left new" },
    { id: "right", title: "right new" },
  ]);
  assert.deepEqual(prepared.errors, []);
  const [left, right] = prepared.preparedRows;
  const existing = new Map([
    [left.fingerprint, Object.freeze({ id: "left", title: "left old" })],
    [right.fingerprint, Object.freeze({ id: "right", title: "right old" })],
  ]);
  let reads = 0;
  const db = { prepare() {
    reads++;
    return { bind() { return { async all() { return { results: [] }; } }; } };
  } };

  // A mutable preparedRows array remains caller-owned; replacing one entry
  // must not make the D1 SELECT and the later audit identify different rows.
  const invalid = [
    [{ ...left, fingerprint: right.fingerprint }, right],
    [{ ...left, pk: { id: "right" } }, right],
    [{ ...left, row: { id: "right", title: "left new" } }, right],
    [left, { ...right, fingerprint: spreadsheetImportPrimaryKeyFingerprint({ id: "extra" }) }],
    [left, left],
  ];
  for (const entries of invalid) {
    const unsafe = { errors: [], preparedRows: entries };
    assert.throws(
      () => planSpreadsheetImportMutations(ctx, unsafe, "upsert", existing, "operator"),
      /invalid_row|duplicate_primary_key/,
    );
    assert.throws(
      () => planSpreadsheetImportMutations(ctx, unsafe, "insert", null, "operator"),
      /invalid_row|duplicate_primary_key/,
    );
    await assert.rejects(fetchSpreadsheetExistingImportRows(db, ctx, unsafe, 1),
      /invalid_row|duplicate_primary_key/);
    assert.equal(reads, 0, "an inconsistent identity must fail before D1 prepares SQL");
  }

  const valid = planSpreadsheetImportMutations(ctx, prepared, "upsert", existing, "operator");
  assert.deepEqual([valid.inserted, valid.updated, valid.skipped], [0, 2, 0]);
  assert.deepEqual(valid.mutations.map(m => m.audit.target_id), ["left", "right"]);
  assert.deepEqual(valid.mutations.map(m => m.audit.before.title), ["left old", "right old"]);
  assert.deepEqual(valid.mutations.map(m => m.audit.after.title), ["left new", "right new"]);
  const checked = await fetchSpreadsheetExistingImportRows(db, ctx, prepared, 1);
  assert.equal(reads, 1, "valid identities still permit the existing one-read preflight");
  assert.equal(checked.size, 0);
});


test("MIG-0638 U01b: CRUD pre-read freezes the verified PK and before-image", async () => {
  const {
    fetchSpreadsheetRawSnapshot, buildSpreadsheetAuditedUpdate,
    buildSpreadsheetAuditedDelete,
  } = await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(c => c.name),
    primaryKeys: ["id"],
  };
  let keyReads = 0, titleReads = 0;
  const mutable = Object.defineProperties({}, {
    id: { enumerable: true, configurable: true, get() {
      keyReads++;
      return keyReads === 1 ? "slot-1" : "wrong-slot";
    } },
    title: { enumerable: true, configurable: true, get() {
      titleReads++;
      return titleReads === 1 ? "before" : "tampered";
    } },
  });
  let selects = 0;
  const db = {
    prepare(sql) {
      selects++;
      assert.equal(sql, 'SELECT * FROM "slots" WHERE "id" = ? LIMIT 1');
      return { bind(...values) {
        assert.deepEqual(values, ["slot-1"]);
        return { async first() { return mutable; } };
      } };
    },
  };
  const snapshot = await fetchSpreadsheetRawSnapshot(db, ctx, { id: "slot-1" }, 1);
  assert.equal(selects, 1);
  assert.deepEqual(snapshot, { id: "slot-1", title: "before" });
  assert.equal(keyReads, 1, "key must be read once for PK match and CAS");
  assert.equal(titleReads, 1, "before-image must be read once for CAS and audit");
  assert.equal(Object.isFrozen(snapshot), true);
  Object.defineProperty(mutable, "id", { value: "wrong-slot", configurable: true });
  Object.defineProperty(mutable, "title", { value: "tampered", configurable: true });
  const update = buildSpreadsheetAuditedUpdate(ctx, { id: "slot-1" },
    snapshot, { title: "after" }, "operator");
  assert.deepEqual(update.binds, ["after", "slot-1", "slot-1", "before"]);
  assert.deepEqual(update.audit.before, { id: "slot-1", title: "before" });
  assert.deepEqual(update.audit.after, { id: "slot-1", title: "after" });
  const del = buildSpreadsheetAuditedDelete(ctx, { id: "slot-1" },
    snapshot, "operator");
  assert.deepEqual(del.binds, ["slot-1", "slot-1", "before"]);
  assert.deepEqual(del.audit.before, snapshot);
  assert.equal(keyReads, 1);
  assert.equal(titleReads, 1);
});

test("MIG-0638 U01b: malformed/mismatched D1 CRUD pre-read snapshots fail closed", async () => {
  const { fetchSpreadsheetRawSnapshot } =
    await import("../src/routes/admin/spreadsheet/writeValidation.ts");
  const columns = [
    { name: "id", type: "TEXT", notNull: true, pk: 1 },
    { name: "title", type: "TEXT", notNull: false, pk: 0 },
  ];
  const ctx = {
    def: resolveSpreadsheetTableDef("slots", true),
    columns, columnNames: columns.map(c => c.name),
    primaryKeys: ["id"],
  };
  const invalid = [
    { id: "other", title: "unrelated" },
    { id: "slot-1" },
    { id: "slot-1", title: undefined },
    { id: "slot-1", title: { nested: "invalid" } },
    { id: "slot-1", title: true },
    { id: "slot-1", title: Number.NaN },
    { id: "slot-1", title: Number.POSITIVE_INFINITY },
    ["slot-1", "before"],
    Object.defineProperty({ id: "slot-1" }, "title", {
      get() { throw new Error("getter trap"); },
    }),
  ];
  for (const bad of invalid) {
    const db = { prepare() { return { bind() {
      return { async first() { return bad; } };
    } }; } };
    await assert.rejects(
      fetchSpreadsheetRawSnapshot(db, ctx, { id: "slot-1" }, 1),
      error => error instanceof Error && error.message === "invalid_snapshot",
      "bad D1 row must never reach guarded CRUD mutation/audit planning",
    );
  }
  const missingDb = { prepare() { return { bind() {
    return { async first() { return null; } };
  } }; } };
  await assert.rejects(
    fetchSpreadsheetRawSnapshot(missingDb, ctx, { id: "slot-1" }, 1),
    /row_not_found/,
  );
});

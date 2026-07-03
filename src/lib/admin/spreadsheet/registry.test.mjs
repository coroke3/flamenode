import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSpreadsheetPage } from "./constants.ts";
import {
  buildSpreadsheetTableDefs,
  SPREADSHEET_DEPRECATED_READONLY_TABLES,
  SPREADSHEET_READONLY_COLUMNS_BY_TABLE,
  isSpreadsheetColumnEditable,
  isSpreadsheetTableBlocklisted,
  resolveSpreadsheetTableDef,
} from "./registry.ts";

test("normalizeSpreadsheetPage rejects NaN and sub-1", () => {
  assert.equal(normalizeSpreadsheetPage(Number.NaN), 1);
  assert.equal(normalizeSpreadsheetPage(0), 1);
  assert.equal(normalizeSpreadsheetPage(3.7), 3);
});

test("blocklists internal sqlite tables", () => {
  assert.equal(isSpreadsheetTableBlocklisted("sqlite_master"), true);
  assert.equal(isSpreadsheetTableBlocklisted("__drizzle_migrations"), true);
  assert.equal(isSpreadsheetTableBlocklisted("videos"), false);
});

test("buildSpreadsheetTableDefs includes new DB tables automatically", () => {
  const defs = buildSpreadsheetTableDefs(
    ["videos", "brand_new_table"],
    new Set(["videos"]),
  );
  assert.equal(defs.length, 2);
  const fresh = defs.find((d) => d.table === "brand_new_table");
  assert.ok(fresh);
  assert.equal(fresh.inSchema, false);
  assert.equal(fresh.group, "その他");
});

test("resolveSpreadsheetTableDef applies overrides", () => {
  const def = resolveSpreadsheetTableDef("videos", true);
  assert.equal(def.label, "作品");
  assert.equal(def.mode, "editable");
});

test("deprecated DB tables are readonly for spreadsheet import", () => {
  for (const table of SPREADSHEET_DEPRECATED_READONLY_TABLES) {
    const def = resolveSpreadsheetTableDef(table, true);
    assert.equal(def.mode, "readonly", `${table} should be readonly`);
  }
});

test("secret column pattern blocks new token columns", () => {
  const def = resolveSpreadsheetTableDef("user", true);
  assert.equal(isSpreadsheetColumnEditable(def, "api_secret"), false);
  assert.equal(isSpreadsheetColumnEditable(def, "display_name"), true);
});

test("deprecated JSON columns are readonly for spreadsheet import", () => {
  for (const [table, columns] of Object.entries(
    SPREADSHEET_READONLY_COLUMNS_BY_TABLE,
  )) {
    const def = resolveSpreadsheetTableDef(table, true);
    for (const column of columns) {
      assert.equal(
        isSpreadsheetColumnEditable(def, column),
        false,
        `${table}.${column} should be readonly`,
      );
    }
  }
  assert.equal(
    isSpreadsheetColumnEditable(resolveSpreadsheetTableDef("videos", true), "title"),
    true,
  );
});

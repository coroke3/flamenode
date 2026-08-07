import test from "node:test";
import assert from "node:assert/strict";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import * as schema from "../../db/schema.ts";
import { eventGroupEvents, eventGroups, events, videos } from "../../db/schema.ts";
import { normalizeSpreadsheetPage } from "./constants.ts";
import {
  buildSpreadsheetTableDefs,
  isSpreadsheetColumnEditable,
  isSpreadsheetSecretColumn,
  isSpreadsheetTableBlocklisted,
  SPREADSHEET_COLUMN_POLICIES,
  SPREADSHEET_COST_GUARD_READONLY_COLUMNS,
  primaryKeysFromColumns,
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

test("only schema tables on the explicit allowlist are listed", () => {
  const defs = buildSpreadsheetTableDefs(["videos", "brand_new_table"], new Set(["videos"]));
  assert.deepEqual(defs.map((def) => def.table), ["videos"]);
});

test("tables without a primary key have no spreadsheet key", () => {
  assert.deepEqual(primaryKeysFromColumns([{ name: "value", pk: 0 }]), []);
});

test("event_staff cannot be edited directly", () => {
  assert.equal(resolveSpreadsheetTableDef("event_staff", true).mode, "readonly");
});

test("editable canonical enum columns come from schema metadata", () => {
  const expected = {
    event_groups: {
      group_type: ["series", "genre", "related", "collection", "other"],
      visibility_status: ["public", "private", "archived"],
    },
    event_group_events: { relation_type: ["member", "primary", "related"] },
    events: { visibility_status: ["private", "public"] },
    videos: {
      visibility_status: ["pending", "public", "private", "voided"],
    },
  };
  const tables = { event_groups: eventGroups, event_group_events: eventGroupEvents, events, videos };
  for (const [table, columns] of Object.entries(expected)) {
    const metadata = getTableColumns(tables[table]);
    for (const [column, values] of Object.entries(columns)) {
      assert.deepEqual(metadata[column].enumValues, values, `${table}.${column}`);
    }
  }
});

test("every supplemental policy targets a real schema table.column", () => {
  const columns = new Set();
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    for (const column of Object.keys(getTableColumns(value))) {
      columns.add(`${getTableName(value)}.${column}`);
    }
  }
  for (const key of Object.keys(SPREADSHEET_COLUMN_POLICIES)) {
    assert.equal(columns.has(key), true, key);
  }
});

test("secret columns and readonly tables remain protected", () => {
  const user = resolveSpreadsheetTableDef("user", true);
  assert.equal(isSpreadsheetColumnEditable(user, "api_secret"), false);
  assert.equal(isSpreadsheetSecretColumn("lease_token"), true);
  assert.equal(isSpreadsheetSecretColumn("display_name"), false);
  assert.equal(isSpreadsheetColumnEditable(user, "display_name"), true);
  assert.equal(resolveSpreadsheetTableDef("account", true).mode, "readonly");
});

test("system_settings CostGuard canonical columns are spreadsheet-readonly", () => {
  const def = resolveSpreadsheetTableDef("system_settings", true);
  for (const column of SPREADSHEET_COST_GUARD_READONLY_COLUMNS) {
    assert.equal(isSpreadsheetColumnEditable(def, column), false, column);
  }
  assert.equal(isSpreadsheetColumnEditable(def, "operation_mode"), false);
  assert.equal(isSpreadsheetColumnEditable(def, "disabled_features_json"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";
import { eventGroupEvents, eventGroups, events, videos } from "../../db/schema.ts";
import { normalizeSpreadsheetPage } from "./constants.ts";
import {
  applySpreadsheetForcedInsertValues,
  buildSpreadsheetTableDefs,
  SPREADSHEET_DEPRECATED_READONLY_TABLES,
  SPREADSHEET_READONLY_COLUMNS_BY_TABLE,
  isSpreadsheetColumnEditable,
  isSpreadsheetForcedInsertColumn,
  isSpreadsheetTableBlocklisted,
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

test("buildSpreadsheetTableDefs only includes schema tables on the explicit allowlist", () => {
  const defs = buildSpreadsheetTableDefs(
    ["videos", "brand_new_table"],
    new Set(["videos"]),
  );
  assert.equal(defs.length, 1);
  assert.equal(defs[0]?.table, "videos");
});

test("resolveSpreadsheetTableDef applies overrides", () => {
  const def = resolveSpreadsheetTableDef("videos", true);
  assert.equal(def.label, "作品");
  assert.equal(def.mode, "editable");
});

test("tables without a declared primary key have no spreadsheet key", () => {
  assert.deepEqual(
    primaryKeysFromColumns([
      { name: "value", type: "TEXT", notNull: false, pk: 0, editable: true },
    ]),
    [],
  );
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
    events: {
      visibility_status: ["draft", "private", "public", "archived"],
    },
    videos: {
      visibility_status: ["draft", "pending", "public", "limited", "private", "archived", "voided"],
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

test("deprecated DB tables are readonly for spreadsheet import", () => {
  for (const table of SPREADSHEET_DEPRECATED_READONLY_TABLES) {
    assert.equal(resolveSpreadsheetTableDef(table, true).mode, "readonly");
  }
});

test("secret column pattern blocks new token columns", () => {
  const def = resolveSpreadsheetTableDef("user", true);
  assert.equal(isSpreadsheetColumnEditable(def, "api_secret"), false);
  assert.equal(isSpreadsheetColumnEditable(def, "display_name"), true);
});

test("deprecated columns are readonly for spreadsheet import", () => {
  for (const [table, columns] of Object.entries(SPREADSHEET_READONLY_COLUMNS_BY_TABLE)) {
    const def = resolveSpreadsheetTableDef(table, true);
    for (const column of columns) {
      assert.equal(isSpreadsheetColumnEditable(def, column), false);
    }
  }
  assert.equal(isSpreadsheetColumnEditable(resolveSpreadsheetTableDef("videos", true), "title"), true);
});

test("forced spreadsheet insert values normalize fixed chapter markers", () => {
  assert.deepEqual(
    applySpreadsheetForcedInsertValues("video_chapters", { id: "ch-1", marker_kind: "comment" }),
    { id: "ch-1", marker_kind: "chapter" },
  );
  assert.equal(isSpreadsheetForcedInsertColumn("video_chapters", "marker_kind"), true);
  assert.equal(isSpreadsheetForcedInsertColumn("video_chapters", "chapter_label"), false);
});

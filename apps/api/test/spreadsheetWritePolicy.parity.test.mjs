import assert from "node:assert/strict";
import { test } from "node:test";
import * as current from "../../../src/lib/admin/spreadsheet/registry.ts";
import * as target from "../src/routes/admin/spreadsheet/registry.ts";

// MIG-0638 U01a: the Hono writer must not silently lose CURRENT spreadsheet
// policy when the write handlers (RH-004/005/006) are ported in U01b.
// This file intentionally runs without a database, Hono session or remote secret.

test("write policy inventory and per-column rules match CURRENT", () => {
  assert.deepEqual(target.SPREADSHEET_COLUMN_POLICIES, current.SPREADSHEET_COLUMN_POLICIES);
  assert.equal(target.SPREADSHEET_DEFAULT_MAX_CELL_CHARS, current.SPREADSHEET_DEFAULT_MAX_CELL_CHARS);
  for (const qualified of Object.keys(current.SPREADSHEET_COLUMN_POLICIES)) {
    const dot = qualified.indexOf(".");
    const table = qualified.slice(0, dot);
    const column = qualified.slice(dot + 1);
    assert.deepEqual(
      target.getSpreadsheetColumnPolicy(table, column),
      current.getSpreadsheetColumnPolicy(table, column),
      qualified,
    );
  }
});

test("runtime enum metadata augments rather than erases a fixed rule", () => {
  const enumValues = ["draft", "published"];
  assert.deepEqual(
    target.getSpreadsheetColumnPolicy("events", "review_settings", enumValues),
    current.getSpreadsheetColumnPolicy("events", "review_settings", enumValues),
  );
  assert.deepEqual(
    target.getSpreadsheetColumnPolicy("unknown", "custom", enumValues),
    { enum: enumValues },
  );
  assert.deepEqual(target.getSpreadsheetColumnPolicy("unknown", "custom"), {});
});

test("physical DELETE denylist matches CURRENT, including public and identity tables", () => {
  assert.deepEqual(
    target.SPREADSHEET_PHYSICAL_DELETE_BLOCKED_TABLES,
    current.SPREADSHEET_PHYSICAL_DELETE_BLOCKED_TABLES,
  );
  for (const table of [
    "events", "event_groups", "system_settings", "videos", "x_users",
    "slots", "video_chapters", "announcements", "user",
  ]) {
    assert.equal(
      target.isSpreadsheetPhysicalDeleteBlocked(table),
      current.isSpreadsheetPhysicalDeleteBlocked(table),
      table,
    );
  }
  for (const table of ["events", "event_groups", "system_settings", "videos", "x_users"]) {
    assert.equal(target.isSpreadsheetPhysicalDeleteBlocked(table), true, table);
  }
});

test("secret, visibility, blocked table and readonly policy cannot drift", () => {
  assert.deepEqual(
    target.SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS,
    current.SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS,
  );
  assert.deepEqual(target.SPREADSHEET_SECRET_COLUMNS, current.SPREADSHEET_SECRET_COLUMNS);
  assert.deepEqual(target.SPREADSHEET_TABLE_BLOCKLIST, current.SPREADSHEET_TABLE_BLOCKLIST);
  for (const column of ["access_token", "client_secret", "api_credentials", "password"]) {
    assert.equal(target.isSpreadsheetSecretColumn(column), true, column);
    assert.equal(target.isSpreadsheetSecretColumn(column), current.isSpreadsheetSecretColumn(column));
  }
  for (const table of ["events", "videos", "event_groups", "x_users"]) {
    const def = target.resolveSpreadsheetTableDef(table, true);
    const column = table === "x_users" ? "approval_status" : "visibility_status";
    assert.equal(target.isSpreadsheetColumnEditable(def, column), false, table);
  }
  const readonly = target.resolveSpreadsheetTableDef("system_settings", true);
  assert.equal(target.isSpreadsheetColumnEditable(readonly, "value"), false);
  for (const name of ["sqlite_master", "_private", "d1_migrations"]) {
    assert.equal(target.isSpreadsheetTableBlocklisted(name), true, name);
  }
});

test("policy getters return independent objects instead of shared mutable state", () => {
  const first = target.getSpreadsheetColumnPolicy("events", "review_settings");
  first.maxLength = 1;
  assert.equal(
    target.getSpreadsheetColumnPolicy("events", "review_settings").maxLength,
    current.getSpreadsheetColumnPolicy("events", "review_settings").maxLength,
  );
});

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
  SPREADSHEET_PHYSICAL_DELETE_BLOCKED_TABLES,
  SPREADSHEET_TABLE_OVERRIDES,
  SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS,
  isSpreadsheetPhysicalDeleteBlocked,
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

test("x_user_aliases is changed only through the dedicated X ID approval flow", () => {
  assert.equal(resolveSpreadsheetTableDef("x_user_aliases", true).mode, "readonly");
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
  assert.equal(isSpreadsheetColumnEditable(user, "display_name"), false);
  assert.equal(resolveSpreadsheetTableDef("account", true).mode, "readonly");
});

test("user and terms_versions have dedicated admin UI and are spreadsheet-readonly", () => {
  const user = resolveSpreadsheetTableDef("user", true);
  const terms = resolveSpreadsheetTableDef("terms_versions", true);
  assert.equal(user.mode, "readonly");
  assert.equal(terms.mode, "readonly");
  for (const column of ["role", "is_banned", "can_create_events", "is_notification_enabled"]) {
    assert.equal(isSpreadsheetColumnEditable(user, column), false, column);
  }
  assert.equal(isSpreadsheetColumnEditable(terms, "body_markdown"), false);
});

test("system_settings is spreadsheet-readonly; settings are edited from dedicated admin UIs", () => {
  const def = resolveSpreadsheetTableDef("system_settings", true);
  assert.equal(def.mode, "readonly");
  for (const column of [
    "id",
    "operation_mode",
    "disabled_features_json",
    "cost_guard_reason",
    "cost_guard_updated_by_user_id",
    "cost_guard_updated_at",
    "cost_guard_exception_until",
    "cost_guard_exception_features_json",
    "default_editable_fields",
    "upcoming_editable_fields",
    "audit_normal_retention_days",
    "audit_updated_by_auth_user_id",
  ]) {
    assert.equal(isSpreadsheetColumnEditable(def, column), false, column);
  }
});

test("auth / identity / permission / system tables are all readonly with no exceptions", () => {
  const protectedTables = [
    "user",
    "account",
    "session",
    "verificationToken",
    "x_user_aliases",
    "x_identity_requests",
    "x_user_account_links",
    "event_staff",
    "user_tos_consents",
    "terms_versions",
    "notification_outbox",
    "audit_logs",
    "system_settings",
  ];
  for (const table of protectedTables) {
    const def = resolveSpreadsheetTableDef(table, true);
    assert.equal(def.mode, "readonly", table);
    for (const column of ["id", "name", "role", "status", "created_at"]) {
      assert.equal(isSpreadsheetColumnEditable(def, column), false, `${table}.${column}`);
    }
  }
  // group ラベルが「認証」「システム」のテーブルは例外なくすべて readonly。
  for (const [table, override] of Object.entries(SPREADSHEET_TABLE_OVERRIDES)) {
    if (override.group !== "認証" && override.group !== "システム") continue;
    assert.equal(override.mode, "readonly", table);
  }
  assert.equal(resolveSpreadsheetTableDef("system_settings", true).group, "システム");
});

test("column policies are defined only for editable tables", () => {
  for (const key of Object.keys(SPREADSHEET_COLUMN_POLICIES)) {
    const table = key.slice(0, key.indexOf("."));
    assert.equal(resolveSpreadsheetTableDef(table, true).mode, "editable", key);
  }
});

test("all public visibility state is controlled by dedicated transition actions", () => {
  const eventDef = resolveSpreadsheetTableDef("events", true);
  const videoDef = resolveSpreadsheetTableDef("videos", true);
  const eventGroupDef = resolveSpreadsheetTableDef("event_groups", true);
  const xUserDef = resolveSpreadsheetTableDef("x_users", true);
  assert.equal(isSpreadsheetColumnEditable(eventDef, "visibility_status"), false);
  assert.equal(isSpreadsheetColumnEditable(videoDef, "visibility_status"), false);
  assert.equal(isSpreadsheetColumnEditable(eventGroupDef, "visibility_status"), false);
  assert.equal(isSpreadsheetColumnEditable(xUserDef, "approval_status"), false);
  assert.equal(isSpreadsheetColumnEditable(eventDef, "title"), true);
  assert.equal(isSpreadsheetColumnEditable(videoDef, "title"), true);
  assert.equal(SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS.has("events.visibility_status"), true);
  assert.equal(SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS.has("videos.visibility_status"), true);
  assert.equal(SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS.has("event_groups.visibility_status"), true);
  assert.equal(SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS.has("x_users.approval_status"), true);
});

test("public entities and system settings cannot be physically deleted through the generic spreadsheet route", () => {
  assert.equal(isSpreadsheetPhysicalDeleteBlocked("events"), true);
  assert.equal(isSpreadsheetPhysicalDeleteBlocked("videos"), true);
  assert.equal(isSpreadsheetPhysicalDeleteBlocked("system_settings"), true);
  assert.equal(isSpreadsheetPhysicalDeleteBlocked("event_groups"), true);
  assert.equal(isSpreadsheetPhysicalDeleteBlocked("x_users"), true);
  assert.equal(SPREADSHEET_PHYSICAL_DELETE_BLOCKED_TABLES.has("videos"), true);
  assert.equal(
    SPREADSHEET_PHYSICAL_DELETE_BLOCKED_TABLES.has("system_settings"),
    true,
  );
});

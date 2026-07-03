import test from "node:test";
import assert from "node:assert/strict";
import { buildSpreadsheetImportPreviewToken } from "./importPreviewToken.ts";

test("spreadsheet import preview token is stable across row key order", async () => {
  const a = await buildSpreadsheetImportPreviewToken({
    table: "events",
    mode: "upsert",
    columns: ["id", "title"],
    primaryKeys: ["id"],
    rows: [{ id: "event-1", title: "Event 1" }],
  });
  const b = await buildSpreadsheetImportPreviewToken({
    table: "events",
    mode: "upsert",
    columns: ["id", "title"],
    primaryKeys: ["id"],
    rows: [{ title: "Event 1", id: "event-1" }],
  });

  assert.equal(a, b);
});

test("spreadsheet import preview token changes with apply mode", async () => {
  const base = {
    table: "events",
    columns: ["id", "title"],
    primaryKeys: ["id"],
    rows: [{ id: "event-1", title: "Event 1" }],
  };

  const insert = await buildSpreadsheetImportPreviewToken({
    ...base,
    mode: "insert",
  });
  const upsert = await buildSpreadsheetImportPreviewToken({
    ...base,
    mode: "upsert",
  });

  assert.notEqual(insert, upsert);
});

test("spreadsheet import preview token changes with row content", async () => {
  const base = {
    table: "events",
    mode: "upsert",
    columns: ["id", "title"],
    primaryKeys: ["id"],
  };

  const original = await buildSpreadsheetImportPreviewToken({
    ...base,
    rows: [{ id: "event-1", title: "Event 1" }],
  });
  const changed = await buildSpreadsheetImportPreviewToken({
    ...base,
    rows: [{ id: "event-1", title: "Changed" }],
  });

  assert.notEqual(original, changed);
});

test("spreadsheet import preview token changes with target table", async () => {
  const base = {
    mode: "upsert",
    columns: ["id", "title"],
    primaryKeys: ["id"],
    rows: [{ id: "event-1", title: "Event 1" }],
  };

  const events = await buildSpreadsheetImportPreviewToken({
    ...base,
    table: "events",
  });
  const videos = await buildSpreadsheetImportPreviewToken({
    ...base,
    table: "videos",
  });

  assert.notEqual(events, videos);
});

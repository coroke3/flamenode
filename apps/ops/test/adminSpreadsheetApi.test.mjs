import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadSpreadsheetCatalog,
  loadSpreadsheetPage,
} from "../.test-dist/apps/ops/src/api/adminSpreadsheet.js";

const table = { table: "videos", label: "動画", group: "コンテンツ", mode: "readonly" };
const catalog = {
  tables: [table],
  groups: { "コンテンツ": [table] },
  pageSize: 50,
  discoveredAt: "2026-10-30T00:00:00.000Z",
};
const page = {
  def: table,
  columns: [{ name: "id", type: "TEXT", notNull: true, pk: 1, editable: false }],
  primaryKeys: ["id"],
  rows: [{ id: "v-1" }],
  hasMore: false,
  page: 1,
  limit: 50,
};
const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("MIG-0737 U01 RH-009: catalog preserves CURRENT URL, refresh and no-store", async () => {
  const calls = [];
  const fetchFn = async (path, init) => {
    calls.push({ path, init });
    return json(200, catalog);
  };
  assert.deepEqual(await loadSpreadsheetCatalog(fetchFn), { status: "ok", data: catalog });
  assert.deepEqual(await loadSpreadsheetCatalog(fetchFn, true), { status: "ok", data: catalog });
  assert.deepEqual(calls.map((x) => x.path), [
    "/api/admin/spreadsheet/tables",
    "/api/admin/spreadsheet/tables?refresh=1",
  ]);
  for (const { init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.accept, "application/json");
    assert.equal("body" in init, false);
  }
});

test("MIG-0737 U01 RH-003: table is encoded and page DTO is schema-validated", async () => {
  let path;
  const fetchFn = async (url) => { path = url; return json(200, page); };
  assert.deepEqual(await loadSpreadsheetPage(fetchFn, "video/2026 & A", 2),
    { status: "ok", data: page });
  assert.equal(path, "/api/admin/spreadsheet/data?table=video%2F2026%20%26%20A&page=2");
  assert.deepEqual(await loadSpreadsheetPage(fetchFn, "", 1), { status: "unavailable" });
  assert.deepEqual(await loadSpreadsheetPage(fetchFn, "videos", 0), { status: "unavailable" });
  assert.deepEqual(await loadSpreadsheetPage(fetchFn, "videos", 1.5), { status: "unavailable" });
});

test("MIG-0737 T01: only explicit 404 spreadsheet_disabled renders disabled state", async () => {
  assert.deepEqual(await loadSpreadsheetCatalog(async () =>
    json(404, { error: "spreadsheet_disabled" })), { status: "disabled" });
  assert.deepEqual(await loadSpreadsheetCatalog(async () =>
    json(404, { error: "unknown_table" })), { status: "notFound" });
  assert.deepEqual(await loadSpreadsheetCatalog(async () =>
    new Response("<html>not found</html>", { status: 404 })), { status: "notFound" });
  assert.deepEqual(await loadSpreadsheetPage(async () =>
    json(404, { error: "spreadsheet_disabled" }), "videos", 1), { status: "disabled" });
});

test("MIG-0737 U01: authentication and denial are never interpreted as feature disablement", async () => {
  const states = [
    [401, { error: "unauthorized" }, { status: "anonymous" }],
    [403, { reason: "admin_required", redirect: "/dashboard" },
      { status: "forbidden", reason: "admin_required", redirect: "/dashboard" }],
    [403, { reason: { secret: true }, redirect: ["bad"] }, { status: "forbidden" }],
    [501, { error: "unsupported" }, { status: "unsupported" }],
    [500, { error: "failed" }, { status: "unavailable" }],
  ];
  for (const [status, body, expected] of states) {
    assert.deepEqual(await loadSpreadsheetCatalog(async () => json(status, body)), expected);
  }
});

test("MIG-0737 U01: malformed/partial catalog or page is unavailable, never accepted", async () => {
  for (const value of [{}, { tables: "oops" }, { ...catalog, tables: [{ ...table, mode: "superuser" }] }]) {
    assert.deepEqual(await loadSpreadsheetCatalog(async () => json(200, value)),
      { status: "unavailable" });
  }
  for (const value of [{}, { ...page, rows: "private" }, { ...page, hasMore: "yes" }]) {
    assert.deepEqual(await loadSpreadsheetPage(async () => json(200, value), "videos", 1),
      { status: "unavailable" });
  }
});

test("MIG-0737 U01: fetch failure, invalid JSON and aborted responses fail closed", async () => {
  assert.deepEqual(await loadSpreadsheetCatalog(async () => { throw Error("offline"); }),
    { status: "unavailable" });
  assert.deepEqual(await loadSpreadsheetCatalog(async () => new Response("error", { status: 200 })),
    { status: "unavailable" });
  const controller = new AbortController();
  let signal;
  assert.deepEqual(await loadSpreadsheetCatalog(async (_, init) => {
    signal = init.signal;
    controller.abort();
    return json(200, catalog);
  }, false, controller.signal), { status: "unavailable" });
  assert.equal(signal, controller.signal);
});

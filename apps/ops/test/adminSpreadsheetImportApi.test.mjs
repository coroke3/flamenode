import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_IMPORT_TEXT_CHARS,
  MAX_IMPORT_APPLY_ROWS,
  previewSpreadsheetImport,
  applySpreadsheetImport,
  spreadsheetImportFingerprint,
} from "../.test-dist/apps/ops/src/api/adminSpreadsheetImport.js";

const draft = { table: "videos", text: "id,title\n1,alpha", hasHeader: true, delimiter: "csv", mode: "upsert" };
const preview = {
  rowCount: 1, mappedColumns: ["id", "title"], warnings: [], preview: [{ id: "1", title: "alpha" }],
  previewToken: "opaque-server-preview-token", applyMaxRows: 7,
};
const applied = { inserted: 0, updated: 1, skipped: 0, pendingPublicReflection: true };
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("MIG-0737 RH-008 dryRun true posts CURRENT JSON with no previewToken", async () => {
  const calls = [];
  const fn = async (path, init) => {
    calls.push([path, init]);
    return json(200, preview);
  };
  assert.deepEqual(await previewSpreadsheetImport(fn, draft), { status: "ok", data: preview });
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "/api/admin/spreadsheet/import");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.equal(init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), { ...draft, dryRun: true });
  assert.equal("previewToken" in JSON.parse(init.body), false);
});

test("MIG-0737 RH-008 apply requires identical snapshot plus preview token, never dryRun", async () => {
  let sent;
  const fn = async (path, init) => {
    sent = { path, init };
    return json(200, applied);
  };
  assert.deepEqual(await applySpreadsheetImport(fn, draft, preview, spreadsheetImportFingerprint(draft)), {
    status: "ok", data: applied,
  });
  assert.equal(sent.path, "/api/admin/spreadsheet/import");
  assert.equal(sent.init.method, "POST");
  const posted = JSON.parse(sent.init.body);
  assert.deepEqual(posted, { ...draft, previewToken: preview.previewToken });
  assert.equal("dryRun" in posted, false);
});

test("MIG-0737 RH-008 changes to text/mode/header/delimiter/table invalidate preview without POST", async () => {
  let calls = 0;
  const fn = async () => { calls++; return json(200, applied); };
  const fingerprint = spreadsheetImportFingerprint(draft);
  const modifications = [
    { ...draft, text: "id,title\n2,bravo" },
    { ...draft, mode: "insert" },
    { ...draft, hasHeader: false },
    { ...draft, delimiter: "tsv" },
    { ...draft, table: "events" },
  ];
  for (const changed of modifications) {
    assert.deepEqual(await applySpreadsheetImport(fn, changed, preview, fingerprint),
      { status: "unavailable" });
  }
  assert.equal(calls, 0);
});

test("MIG-0737 RH-008 missing preview token, too many rows and oversized text never apply", async () => {
  let calls = 0;
  const fn = async () => { calls++; return json(200, applied); };
  for (const invalidPreview of [
    { ...preview, previewToken: "" },
    { ...preview, rowCount: MAX_IMPORT_APPLY_ROWS + 1 },
    { ...preview, rowCount: 0 },
    { ...preview, rowCount: 3, applyMaxRows: 2 },
  ]) {
    assert.deepEqual(await applySpreadsheetImport(fn, draft, invalidPreview, spreadsheetImportFingerprint(draft)),
      { status: "unavailable" });
  }
  const oversized = { ...draft, text: "x".repeat(MAX_IMPORT_TEXT_CHARS + 1) };
  assert.deepEqual(await previewSpreadsheetImport(fn, oversized), { status: "unavailable" });
  assert.deepEqual(await applySpreadsheetImport(fn, oversized, preview, spreadsheetImportFingerprint(oversized)),
    { status: "unavailable" });
  assert.equal(calls, 0);
});

test("MIG-0737 RH-008 malformed preview/token and bad apply counters fail closed", async () => {
  for (const invalid of [
    { rowCount: 1, preview: [], mappedColumns: [], warnings: [] },
    { ...preview, previewToken: "" },
    { ...preview, rowCount: "one" },
    { ...preview, preview: [{ id: 5 }] },
    { ...preview, rowCount: 501 },
    { ...preview, rowCount: 1, preview: [{ id: "1" }, { id: "2" }] },
  ]) {
    assert.deepEqual(await previewSpreadsheetImport(async () => json(200, invalid), draft),
      { status: "unavailable" });
  }
  for (const invalid of [
    { inserted: -1, updated: 1, skipped: 0 },
    { inserted: "one", updated: 1, skipped: 0 },
    { inserted: 0, updated: 1 },
  ]) {
    assert.deepEqual(await applySpreadsheetImport(async () => json(200, invalid), draft, preview,
      spreadsheetImportFingerprint(draft)), { status: "unavailable" });
  }
});

test("MIG-0737 RH-008 distinguish feature-disabled 404 from unknown-table, auth, unsupported, and 409", async () => {
  const cases = [
    [404, { error: "spreadsheet_disabled" }, "disabled"],
    [404, { error: "unknown_table" }, "notFound"],
    [401, { error: "unauthorized" }, "anonymous"],
    [403, { error: "admin_required" }, "forbidden"],
    [501, { error: "unsupported" }, "unsupported"],
    [409, { error: "preview_required" }, "unavailable"],
    [423, { error: "cost_guard" }, "unavailable"],
    [500, { error: "internal_error" }, "unavailable"],
  ];
  for (const [status, body, expected] of cases) {
    const fn = async () => json(status, body);
    assert.equal((await previewSpreadsheetImport(fn, draft)).status, expected);
    assert.equal((await applySpreadsheetImport(fn, draft, preview,
      spreadsheetImportFingerprint(draft))).status, expected);
  }
});

test("MIG-0737 RH-008 aborted and offline requests return unavailable", async () => {
  let calls = 0;
  const ac = new AbortController();
  ac.abort();
  const fn = async () => { calls++; return json(200, preview); };
  assert.deepEqual(await previewSpreadsheetImport(fn, draft, ac.signal), { status: "unavailable" });
  assert.deepEqual(await applySpreadsheetImport(fn, draft, preview, spreadsheetImportFingerprint(draft),
    ac.signal), { status: "unavailable" });
  assert.equal(calls, 0);
  assert.deepEqual(await previewSpreadsheetImport(async () => { throw Error("offline"); }, draft),
    { status: "unavailable" });
  assert.deepEqual(await applySpreadsheetImport(async () => { throw Error("offline"); }, draft,
    preview, spreadsheetImportFingerprint(draft)), { status: "unavailable" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { MAX_LEGACY_VIDEO_FIELD_DECISIONS as CURRENT_DECISION_LIMIT } from "../../../src/lib/import/legacy/normalize.ts";
import { MAX_LEGACY_IMPORT_SELECTED_ROWS as CURRENT_ROWS_LIMIT } from "../../../src/lib/import/legacy/cpuBudget.ts";
import {
  legacyImportMode, legacyImportVisibility, legacyImportStrategy,
  legacyImportStringField, MAX_LEGACY_VIDEO_FIELD_DECISIONS, MAX_LEGACY_IMPORT_SELECTED_ROWS,
  validateLegacyImportFileEnvelope,
  validateLegacyImportSelectedRows, parseLegacyImportVideoFieldDecisions,
} from "../src/routes/admin/legacyImportInput.ts";

test("RH-002 U02 input boundary: pinned limits match CURRENT", () => {
  assert.equal(MAX_LEGACY_VIDEO_FIELD_DECISIONS, CURRENT_DECISION_LIMIT);
  assert.equal(MAX_LEGACY_IMPORT_SELECTED_ROWS, CURRENT_ROWS_LIMIT);
});

test("RH-002 U02 input boundary: mode, visibility and strategy follow CURRENT fallback", () => {
  assert.equal(legacyImportMode("apply"), "apply");
  for (const value of [null, "preview", "APPLY", "other"]) assert.equal(legacyImportMode(value), "preview");
  assert.equal(legacyImportVisibility("private"), "private");
  for (const value of [null, "PUBLIC", "hidden"]) assert.equal(legacyImportVisibility(value), "public");
  for (const value of ["skip_existing", "replace_imported"]) assert.equal(legacyImportStrategy(value), value);
  for (const value of [null, "CREATE_ONLY", "bad"]) assert.equal(legacyImportStrategy(value), "create_only");
  const form = new FormData();
  form.set("value", "  trimmed  ");
  assert.equal(legacyImportStringField(form, "value"), "trimmed");
  assert.equal(legacyImportStringField(form, "missing"), "");
  form.set("value", new Blob(["binary"]), "upload.bin");
  assert.equal(legacyImportStringField(form, "value"), "");
});

test("RH-002 U02 input boundary: file count, individual and aggregate sizes", () => {
  const mib = 1024 * 1024;
  assert.deepEqual(validateLegacyImportFileEnvelope([]), {
    status: 400, message: "JSON・CSV・TSVファイルを選択してください。",
  });
  assert.equal(validateLegacyImportFileEnvelope(Array.from({ length: 20 }, (_, i) => ({
    name: String(i), size: 0,
  }))), null);
  assert.match(validateLegacyImportFileEnvelope(Array.from({ length: 21 }, () => ({
    name: "x", size: 0,
  }))).message, /最大20件/);
  assert.equal(validateLegacyImportFileEnvelope([{ name: "a", size: 2 * mib }]), null);
  assert.match(validateLegacyImportFileEnvelope([{ name: "a", size: 2 * mib + 1 }]).message, /a: 1ファイル2MB/);
  assert.equal(validateLegacyImportFileEnvelope([
    { name: "a", size: 2 * mib }, { name: "b", size: 2 * mib },
  ]), null);
  assert.deepEqual(validateLegacyImportFileEnvelope([
    { name: "a", size: 2 * mib }, { name: "b", size: 2 * mib }, { name: "c", size: 1 },
  ]), { status: 400, message: "ファイル合計は4MBまでです。複数回に分けてください。" });
});

test("RH-002 U02 input boundary: total selected rows are limited after per-file range selection", () => {
  assert.equal(validateLegacyImportSelectedRows(250), null);
  assert.equal(validateLegacyImportSelectedRows(249), null);
  assert.equal(validateLegacyImportSelectedRows(251).status, 413);
  assert.match(validateLegacyImportSelectedRows(251).message, /251行.*250行以下/);
});

test("RH-002 U02 input boundary: decisions preserve CURRENT strict allowlist/error precedence", () => {
  const f = new FormData();
  assert.deepEqual(parseLegacyImportVideoFieldDecisions(f), []);
  f.set("video_custom_field_decisions", JSON.stringify([
    { source_key: "foo", action: "ignore" },
    { source_key: "bar", action: "custom_question", question_label: "Bar?" },
  ]));
  assert.deepEqual(parseLegacyImportVideoFieldDecisions(f), [
    { source_key: "foo", action: "ignore" },
    { source_key: "bar", action: "custom_question", question_label: "Bar?" },
  ]);
  const cases = [
    ["{", /JSON/],
    ["{}", /最大/],
    ['[null]', /1件目が不正/],
    ['[{"source_key":"foo","action":"ignore","extra":1}]', /不明な値/],
    ['[{"source_key":"foo","action":"custom_question"}]', /質問文Q指定/],
    ['[{"source_key":"foo","action":"bad"}]', /処理方法/],
  ];
  for (const [value, error] of cases) {
    f.set("video_custom_field_decisions", value);
    assert.throws(() => parseLegacyImportVideoFieldDecisions(f), error, value);
  }
  f.set("video_custom_field_decisions", "あ".repeat(5462));
  assert.throws(() => parseLegacyImportVideoFieldDecisions(f), /大きすぎます/, "UTF-8 byte ceiling comes before JSON parsing");
});

test("RH-002 U02 input boundary: CURRENT origin and guard precede multipart parsing (not mounted)", async () => {
  const current = await readFile(new URL("../../../app/api/admin/import/legacy/route.ts", import.meta.url), "utf8");
  const origin = current.indexOf("await requireSameOriginWrite(request)");
  const guard = current.indexOf('await requireAdminWrite("admin_legacy_import")');
  const multipart = current.indexOf("await request.formData()");
  assert.ok(origin >= 0 && guard > origin && multipart > guard);
});

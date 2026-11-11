import assert from "node:assert/strict";
import { test } from "node:test";
import { readLegacyImportPreviewFiles } from "../src/routes/admin/legacyImportFiles.ts";

function harness({ sizes = [3], rowsPerFile = [3], range = {} } = {}) {
  const calls = [];
  const formData = new FormData();
  for (const [key, value] of Object.entries(range)) formData.set(key, value);
  const files = sizes.map((size, index) => ({
    name: `file-${index}.csv`,
    size,
    text: async () => {
      calls.push(`read:${index}`);
      return String(index);
    },
  }));
  const parseText = (name, text) => ({
    name,
    rows: Array.from({ length: rowsPerFile[Number(text)] ?? 0 }, (_, i) => ({ index: i + 1 })),
    rowOffset: 0,
  });
  const selectRange = (file, input) => {
    const startRow = input.start ? Number(input.start) : 1;
    const endRow = input.end ? Number(input.end) : file.rows.length;
    if (startRow > file.rows.length) throw new Error("開始位置がデータ件数を超えています。");
    if (endRow < startRow) throw new Error("終了位置は開始位置以上にしてください。");
    return {
      file: { ...file, rows: file.rows.slice(startRow - 1, endRow), rowOffset: startRow - 1 },
      range: {
        fileName: file.name,
        sourceRows: file.rows.length,
        startRow, endRow,
        selectedRows: endRow - startRow + 1,
      },
    };
  };
  return { formData, files, parseText, selectRange, calls };
}

test("RH-002 U02 preview: reject oversized file envelope without reading any file", async () => {
  const h = harness({ sizes: [2 * 1024 * 1024 + 1] });
  const result = await readLegacyImportPreviewFiles(h);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.body.message, /1ファイル2MB/);
  assert.deepEqual(h.calls, []);
  const many = harness({ sizes: Array(21).fill(0) });
  assert.equal((await readLegacyImportPreviewFiles(many)).status, 400);
  assert.deepEqual(many.calls, []);
  const aggregate = harness({ sizes: [2 * 1024 * 1024, 2 * 1024 * 1024, 1] });
  assert.match((await readLegacyImportPreviewFiles(aggregate)).body.message, /合計は4MB/);
  assert.deepEqual(aggregate.calls, []);
});

test("RH-002 U02 preview: preserve original row numbering, filename index and totals", async () => {
  const h = harness({
    sizes: [10, 10],
    rowsPerFile: [10, 7],
    range: { range_start_0: "2", range_end_0: "4", range_start_1: "5", range_end_1: "7" },
  });
  const result = await readLegacyImportPreviewFiles(h);
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls, ["read:0", "read:1"]);
  assert.equal(result.sourceRowCount, 17);
  assert.equal(result.rowCount, 6);
  assert.deepEqual(result.parsed.map((file) => [file.rowOffset, file.rows.length]), [[1, 3], [4, 3]]);
  assert.deepEqual(result.fileRanges.map((range) => [range.startRow, range.endRow]), [[2, 4], [5, 7]]);
});

test("RH-002 U02 preview: precisely 250 selected rows allowed; 251 fail with ranges", async () => {
  const h = harness({ rowsPerFile: [251], range: { range_end_0: "250" } });
  assert.equal((await readLegacyImportPreviewFiles(h)).ok, true);
  h.formData.set("range_end_0", "251");
  const rejected = await readLegacyImportPreviewFiles(h);
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.requires_repreview, false);
  assert.equal(rejected.body.file_ranges[0].selectedRows, 251);
  assert.match(rejected.body.message, /251行.*250行以下/);
});

test("RH-002 U02 preview: parse/range error short-circuits subsequent files", async () => {
  const h = harness({ sizes: [1, 1], rowsPerFile: [1, 1], range: { range_start_0: "2" } });
  const result = await readLegacyImportPreviewFiles(h);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.body.message, /開始位置/);
  assert.deepEqual(h.calls, ["read:0"]);
});

test("RH-002 U02 preview: at most 250 rows is aggregate across files", async () => {
  const h = harness({ sizes: [1, 1], rowsPerFile: [125, 125] });
  const allowed = await readLegacyImportPreviewFiles(h);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.rowCount, 250);
  h.parseText = (name, text) => ({
    name,
    rows: Array.from({ length: Number(text) === 0 ? 126 : 125 }, (_, i) => ({ index: i })),
  });
  const rejected = await readLegacyImportPreviewFiles(h);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.file_ranges.length, 2);
});

test("RH-002 U02 preview: real shared CSV parser and range are used by default", async () => {
  const formData = new FormData();
  formData.set("range_start_0", "2");
  formData.set("range_end_0", "3");
  const files = [{
    name: "legacy.csv",
    size: 40,
    text: async () => "id,title\n1,one\n2,two\n3,three\n4,four\n",
  }];
  const result = await readLegacyImportPreviewFiles({ formData, files });
  assert.equal(result.ok, true);
  assert.deepEqual(result.parsed, [{
    name: "legacy.csv", rows: [
      { id: "2", title: "two" },
      { id: "3", title: "three" },
    ], rowOffset: 1,
  }]);
  assert.equal(result.sourceRowCount, 4);
  assert.equal(result.rowCount, 2);
});

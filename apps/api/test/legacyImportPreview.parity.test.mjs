import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLegacyImportText } from "@flamenode/server-core/legacyImport/parse";
import { readLegacyImportPreviewFiles } from "../src/routes/admin/legacyImportFiles.ts";
import { prepareLegacyImportPreview } from "../src/routes/admin/legacyImportPreview.ts";

async function makePreview({ content = "id,title\nlegacy-1,Test\n", decisions, range } = {}) {
  const formData = new FormData();
  if (decisions !== undefined) formData.set("video_custom_field_decisions", decisions);
  if (range) formData.set("range_end_0", range);
  const files = await readLegacyImportPreviewFiles({
    formData,
    files: [{ name: "legacy.csv", size: 40, text: async () => content }],
  });
  assert.equal(files.ok, true);
  return { formData, files };
}

test("RH-002 U02 preview: actual canonical parser, row range, normalize and CPU budget", async () => {
  const { formData, files } = await makePreview();
  formData.set("strategy", "skip_existing");
  const result = prepareLegacyImportPreview({ formData, files, now: 1700000000 });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "preview");
  assert.equal(result.strategy, "skip_existing");
  assert.equal(result.summary.inputFiles, 1);
  assert.equal(result.summary.sourceRows, 1);
  assert.equal(result.summary.inputRows, 1);
  for (const key of ["events", "videos", "xUsers", "warnings", "errors"]) {
    assert.equal(typeof result.summary[key], "number");
  }
  assert.ok(Array.isArray(result.plan.events));
  assert.ok(Array.isArray(result.plan.videos));
  assert.deepEqual(result.fileRanges, files.fileRanges);
});

test("RH-002 U02 preview: malformed decisions fail with CURRENT 400 before normalization", async () => {
  const { formData, files } = await makePreview({ decisions: "{" });
  const result = prepareLegacyImportPreview({ formData, files, now: 1700000000 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.body.message, /JSONとして読み取れません/);
  assert.deepEqual(Object.keys(result.body).sort(), ["message", "ok"]);
});

test("RH-002 U02 preview: invalid normalized rows return CURRENT bounded 422 report", async () => {
  const { formData, files } = await makePreview({ decisions: '[{"source_key":"title","action":"custom_question","question_label":"Title"}]' });
  const result = prepareLegacyImportPreview({ formData, files, now: 1700000000 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.body.mode, "preview");
  assert.ok(result.body.summary.errors > 0);
  assert.ok(Array.isArray(result.body.errors));
  assert.ok(result.body.errors.length <= 100);
  assert.deepEqual(result.body.file_ranges, files.fileRanges);
});

test("RH-002 U02 preview: canonical field decisions remain strict in preview", async () => {
  const { formData, files } = await makePreview({
    decisions: '[{"source_key":"foo","action":"ignore","unused":true}]',
  });
  const result = prepareLegacyImportPreview({ formData, files, now: 1700000000 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.body.message, /不明な値/);
});

test("RH-002 U02 preview: source option mode and visibility defaults retain CURRENT behavior", async () => {
  const { formData, files } = await makePreview();
  formData.set("strategy", "unexpected");
  formData.set("event_visibility", "PUBLIC");
  formData.set("video_visibility", "PRIVATE");
  const result = prepareLegacyImportPreview({ formData, files, now: 1700000000 });
  assert.equal(result.ok, true);
  assert.equal(result.strategy, "create_only");
  assert.ok(result.plan.events.every((row) => row.visibility_status === "public"));
  assert.ok(result.plan.videos.every((row) => row.visibility_status === "public"));
});

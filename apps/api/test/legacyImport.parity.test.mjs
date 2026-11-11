import assert from "node:assert/strict";
import { test } from "node:test";
import {
  legacyImportCpuBudgetErrors,
  MAX_LEGACY_IMPORT_SELECTED_ROWS,
  MAX_LEGACY_IMPORT_STEP_BYTES,
  MAX_LEGACY_EVENT_STAFF_PER_EVENT,
  MAX_LEGACY_VIDEO_EVENTS_PER_VIDEO,
  MAX_LEGACY_VIDEO_MEMBERS_PER_VIDEO,
  MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO,
  MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO,
} from "../../../src/lib/import/legacy/cpuBudget.ts";
import {
  selectLegacyParsedFileRange,
  suggestLegacyImportRowRanges,
} from "../../../src/lib/import/legacy/range.ts";

function emptyPlan() {
  return {
    events: [], videos: [], eventStaff: [], videoEvents: [],
    videoMembers: [], videoChapters: [], videoSoftwares: [],
    videoCustomAnswers: [], eventCustomQuestions: [],
  };
}

test("RH-002 CURRENT: selections stop at 250 rows and retain 1-based inclusive positions", () => {
  assert.equal(MAX_LEGACY_IMPORT_SELECTED_ROWS, 250);
  assert.deepEqual(suggestLegacyImportRowRanges(501), [
    { startRow: 1, endRow: 250 },
    { startRow: 251, endRow: 500 },
    { startRow: 501, endRow: 501 },
  ]);
  const source = { name: "sample.csv", rows: [{ id: 1 }, { id: 2 }, { id: 3 }], rowOffset: 10 };
  const selected = selectLegacyParsedFileRange(source, { start: "2", end: "3" });
  assert.deepEqual(selected.file.rows, [{ id: 2 }, { id: 3 }]);
  assert.equal(selected.file.rowOffset, 11);
  assert.deepEqual(selected.range, {
    fileName: "sample.csv", sourceRows: 3, startRow: 2, endRow: 3, selectedRows: 2,
  });
  assert.throws(() => selectLegacyParsedFileRange(source, { start: "3", end: "2" }), /終了位置/);
  assert.throws(() => selectLegacyParsedFileRange(source, { start: "4", end: "4" }), /データ件数/);
});

test("RH-002 CURRENT: exactly 64 event staff are allowed; 65 are rejected", () => {
  assert.equal(MAX_LEGACY_EVENT_STAFF_PER_EVENT, 64);
  const plan = { ...emptyPlan(), events: [{ id: "event-1" }],
    eventStaff: Array.from({ length: 64 }, (_, i) => ({ event_id: "event-1", id: i })) };
  assert.deepEqual(legacyImportCpuBudgetErrors(plan), []);
  plan.eventStaff.push({ event_id: "event-1", id: 64 });
  assert.match(legacyImportCpuBudgetErrors(plan)[0], /最大64件/);
});

test("RH-002 CURRENT: per-video relation caps reject the first excess record", () => {
  const limits = [
    ["videoEvents", "所属イベント", MAX_LEGACY_VIDEO_EVENTS_PER_VIDEO, 16],
    ["videoMembers", "参加メンバー", MAX_LEGACY_VIDEO_MEMBERS_PER_VIDEO, 64],
    ["videoChapters", "チャプター", MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO, 128],
    ["videoSoftwares", "使用ソフト", MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO, 32],
  ];
  for (const [field, label, actual, expected] of limits) {
    assert.equal(actual, expected);
    const plan = { ...emptyPlan(), videos: [{ id: "video-1" }],
      [field]: Array.from({ length: expected }, (_, i) => ({ video_id: "video-1", id: i })) };
    assert.deepEqual(legacyImportCpuBudgetErrors(plan), [], field);
    plan[field].push({ video_id: "video-1", id: expected });
    assert.match(legacyImportCpuBudgetErrors(plan).join(" "), new RegExp(`${label}.*最大${expected}件`));
  }
});

test("RH-002 CURRENT: multibyte UTF-8 step payloads are bounded at 128 KiB", () => {
  assert.equal(MAX_LEGACY_IMPORT_STEP_BYTES, 128 * 1024);
  const plan = { ...emptyPlan(), videos: [{ id: "video-1", title: "あ".repeat(45_000) }] };
  assert.match(legacyImportCpuBudgetErrors(plan).join(" "), /128KB/);
});

test("RH-002 CURRENT: budget errors are capped at 100", () => {
  const plan = { ...emptyPlan(),
    events: Array.from({ length: 101 }, (_, i) => ({ id: String(i), title: "あ".repeat(45_000) })) };
  assert.equal(legacyImportCpuBudgetErrors(plan).length, 100);
});


test("RH-002 CURRENT: range selection is inclusive; chunk suggestions cap at 250", () => {
  const rows = Array.from({ length: 251 }, (_, i) => ({ id: i + 1 }));
  const file = { name: "boundary.csv", rows, rowOffset: 0 };
  const allowed = selectLegacyParsedFileRange(file, { start: "2", end: "251" });
  assert.equal(allowed.file.rows.length, MAX_LEGACY_IMPORT_SELECTED_ROWS);
  assert.equal(allowed.file.rows[0].id, 2);
  assert.equal(allowed.file.rows.at(-1).id, 251);
  const all = selectLegacyParsedFileRange(file, { start: "1", end: "251" });
  assert.equal(all.range.selectedRows, 251, "per-file range selector does not itself enforce aggregate 250-row cap");
  assert.deepEqual(suggestLegacyImportRowRanges(all.range.selectedRows), [
    { startRow: 1, endRow: 250 }, { startRow: 251, endRow: 251 },
  ]);
});

test("RH-002 CURRENT: JSON byte limit is inclusive and counts UTF-8, not JS string length", () => {
  const base = { ...emptyPlan(), events: [{ id: "e", title: "ab" }] };
  const encodedSize = (title) => new TextEncoder().encode(JSON.stringify({
    event: { id: "e", title }, staff: [],
  })).byteLength;
  const remaining = MAX_LEGACY_IMPORT_STEP_BYTES - encodedSize("ab");
  assert.equal(remaining % 3, 0, "fixture must reach the exact Japanese UTF-8 boundary");
  base.events[0].title += "あ".repeat(remaining / 3);
  assert.equal(encodedSize(base.events[0].title), MAX_LEGACY_IMPORT_STEP_BYTES);
  assert.deepEqual(legacyImportCpuBudgetErrors(base), [], "exactly 128 KiB is accepted");
  base.events[0].title += "あ";
  assert.match(legacyImportCpuBudgetErrors(base).join(" "), /128KB/, "one extra UTF-8 character is rejected");
});

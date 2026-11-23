// Regression for bare-CR records in the Hono video chapter CSV parser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChapterBulkCsv } from "../src/routes/videos/chapterCsv.ts";
import { parseDelimited } from "../../../src/lib/utils/delimited.ts";

test("SEC-CSV-CR: Hono chapter import separates CR-only rows and drops the header", () => {
  assert.deepEqual(parseChapterBulkCsv("time,label\r0:01,Start\r0:20,End"), [
    ["0:01", "Start"], ["0:20", "End"],
  ]);
  assert.deepEqual(parseChapterBulkCsv('time,label\r0:01,"Part\rOne"\r0:20,End'), [
    ["0:01", "Part\rOne"], ["0:20", "End"],
  ]);
});

test("SEC-CSV-CR: CRLF and LF remain one record boundary each", () => {
  assert.deepEqual(parseChapterBulkCsv("time,label\r\n0:01,Start\n0:20,End\r0:30,Last"), [
    ["0:01", "Start"], ["0:20", "End"], ["0:30", "Last"],
  ]);
  assert.deepEqual(parseChapterBulkCsv("0:01,Start\r0:20,End"), [
    ["0:01", "Start"], ["0:20", "End"],
  ]);
});

test("SEC-CSV-CR: CURRENT and Hono chapter parser parity across CR/CRLF/LF", () => {
  const samples = [
    "time,label\r0:01,Start\r0:20,End",
    "time,label\r\n0:01,Start\n0:20,End",
    'time,label\r0:01,"Part\rOne"\r0:20,End',
  ];
  for (const csv of samples) {
    const rows = parseDelimited(csv, ",");
    assert.deepEqual(parseChapterBulkCsv(csv), rows.slice(1));
  }
});

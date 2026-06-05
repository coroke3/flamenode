import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "./csv.ts";

test("parseCsv: 単純なカンマ区切り", () => {
  const r = parseCsv("a,b,c\n1,2,3");
  assert.deepEqual(r, [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCsv: クォート内のカンマ・改行・エスケープ", () => {
  const r = parseCsv('"a,b","c\nd","he said ""hi"""');
  assert.deepEqual(r, [["a,b", "c\nd", 'he said "hi"']]);
});

test("parseCsv: CRLF と末尾空行は無視", () => {
  const r = parseCsv("a,b\r\n1,2\r\n\r\n");
  assert.deepEqual(r, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseCsv: BOM 除去", () => {
  const r = parseCsv("﻿a,b\n1,2");
  assert.deepEqual(r, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

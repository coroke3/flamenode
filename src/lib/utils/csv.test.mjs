import test from "node:test";
import assert from "node:assert/strict";

import { parseDelimited, detectDelimiter } from "./delimited.ts";

const parseCsv = (input) => parseDelimited(input, ",");

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

test("detectDelimiter: quoted separators must not change the CSV/TSV type", () => {
  const csv = '\uFEFF\n"Research\tOps\tQA",name\n"Team\tA",Alice';
  assert.equal(detectDelimiter(csv), ",");
  assert.deepEqual(parseDelimited(csv, detectDelimiter(csv)), [
    ["Research\tOps\tQA", "name"], ["Team\tA", "Alice"],
  ]);

  const tsv = '"Staff,Event,Operations"\tname\n"Admin,Owner"\tBob';
  assert.equal(detectDelimiter(tsv), "\t");
  assert.deepEqual(parseDelimited(tsv, detectDelimiter(tsv)), [
    ["Staff,Event,Operations", "name"], ["Admin,Owner", "Bob"],
  ]);
});

test("detectDelimiter: multiline fields and escaped quotes stay inside the first record", () => {
  const csv = '"line 1\nline\t2\t3 ""comma,inside""",name\nvalue,Alice';
  assert.equal(detectDelimiter(csv), ",");
  assert.deepEqual(parseDelimited(csv, detectDelimiter(csv)), [
    ['line 1\nline\t2\t3 "comma,inside"', "name"], ["value", "Alice"],
  ]);
  assert.equal(detectDelimiter("\n \nname,role\nBob,admin"), ",");
  assert.equal(detectDelimiter("\n \nname\trole\nBob\tadmin"), "\t");
});

test("SEC-CSV-CR: bare CR separates CSV/TSV rows without destroying quoted CR", () => {
  const csv = 'name,role\rAlice,owner\rBob,"line 1\rline 2"\r';
  assert.equal(detectDelimiter(csv), ",");
  assert.deepEqual(parseCsv(csv), [
    ["name", "role"], ["Alice", "owner"], ["Bob", "line 1\rline 2"],
  ]);
  assert.deepEqual(parseDelimited(csv, ",", { maxRows: 2 }), [
    ["name", "role"], ["Alice", "owner"],
  ]);
  const tsv = "name\trole\rAlice\towner\rBob\tstaff";
  assert.equal(detectDelimiter(tsv), "\t");
  assert.deepEqual(parseDelimited(tsv, "\t"), [
    ["name", "role"], ["Alice", "owner"], ["Bob", "staff"],
  ]);
  assert.deepEqual(parseCsv("name,role\r\nAlice,owner\nBob,staff\rCarol,guest"), [
    ["name", "role"], ["Alice", "owner"], ["Bob", "staff"], ["Carol", "guest"],
  ]);
});

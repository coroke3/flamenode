import assert from "node:assert/strict";
import { test } from "node:test";
import {
  moveSpreadsheetFocus,
  copySpreadsheetSelection,
} from "../.test-dist/apps/ops/src/routes/admin/spreadsheetGridKeyboard.js";

test("MIG-0737 U01: arrow/home/end navigation clamps to visible grid", () => {
  const initial = { row: 1, col: 1 };
  assert.deepEqual(moveSpreadsheetFocus(initial, "ArrowUp", 3, 4), { row: 0, col: 1 });
  assert.deepEqual(moveSpreadsheetFocus(initial, "ArrowDown", 3, 4), { row: 2, col: 1 });
  assert.deepEqual(moveSpreadsheetFocus(initial, "ArrowLeft", 3, 4), { row: 1, col: 0 });
  assert.deepEqual(moveSpreadsheetFocus(initial, "ArrowRight", 3, 4), { row: 1, col: 2 });
  assert.deepEqual(moveSpreadsheetFocus(initial, "Home", 3, 4), { row: 1, col: 0 });
  assert.deepEqual(moveSpreadsheetFocus(initial, "End", 3, 4), { row: 1, col: 3 });
  assert.deepEqual(moveSpreadsheetFocus({row: 0, col: 0}, "ArrowUp", 3, 4), {row:0,col:0});
  assert.deepEqual(moveSpreadsheetFocus({row: 2, col: 3}, "ArrowRight", 3, 4), {row:2,col:3});
  assert.deepEqual(moveSpreadsheetFocus(initial, " ", 3, 4), initial);
});

test("MIG-0737 U01: invalid grid dimensions fail closed without navigation", () => {
  const focus = { row: 0, col: 0 };
  for (const [rows, cols] of [[0, 4], [2, 0], [Number.NaN, 2], [-1, 4]]) {
    assert.deepEqual(moveSpreadsheetFocus(focus, "ArrowRight", rows, cols), focus);
  }
});

test("MIG-0737 U01: reverse shift selection copies TSV in visual row/column order", () => {
  const rows = [{id:"x1", title:"Alpha", count:4}, {id:"x2", title:"Beta", count:2}];
  const columns = [{name:"id"}, {name:"title"}, {name:"count"}];
  assert.equal(copySpreadsheetSelection(rows, columns, {row:1,col:2}, {row:0,col:1}), "Alpha\t4\nBeta\t2");
  assert.equal(copySpreadsheetSelection(rows, columns, {row:0,col:0}, {row:0,col:0}), "x1");
});

test("MIG-0737 U01: multiline/tab/quoted cell copies preserve TSV boundaries", () => {
  const rows = [
    {title:'A\tB', note:'hello\nworld'},
    {title:'She said "yes"', note: null},
  ];
  const columns=[{name:"title"},{name:"note"}];
  assert.equal(copySpreadsheetSelection(rows,columns,{row:0,col:0},{row:1,col:1}),
    '"A\tB"\t"hello\nworld"\n"She said ""yes"""\t');
});

test("MIG-0737 U01: empty/out-of-range selection yields no unexpected rows", () => {
  assert.equal(copySpreadsheetSelection([],[{name:"id"}],{row:0,col:0},{row:0,col:0}),"");
  assert.equal(copySpreadsheetSelection([{id:"v1"}],[],{row:0,col:0},{row:0,col:0}),"");
  assert.equal(copySpreadsheetSelection([{id:"v1"}],[{name:"id"}],{row:500,col:0},{row:501,col:0}),"");
});

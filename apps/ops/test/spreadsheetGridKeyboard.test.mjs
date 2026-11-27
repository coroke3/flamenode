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

// Fixed CURRENT moveCell characterization cases; the tracked test has no scratch-file dependency.
const navigationParityCases = [
  {"name":"middle ArrowUp","key":"ArrowUp","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":11,"col":2}},
  {"name":"middle ArrowDown","key":"ArrowDown","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":13,"col":2}},
  {"name":"middle ArrowLeft","key":"ArrowLeft","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":1}},
  {"name":"middle ArrowRight","key":"ArrowRight","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":3}},
  {"name":"middle Home","key":"Home","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":0}},
  {"name":"middle End","key":"End","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":4}},
  {"name":"middle CtrlHome","key":"CtrlHome","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":0,"col":0}},
  {"name":"middle CtrlEnd","key":"CtrlEnd","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":24,"col":4}},
  {"name":"middle CtrlArrowUp","key":"CtrlArrowUp","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"middle CtrlArrowDown","key":"CtrlArrowDown","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":24,"col":2}},
  {"name":"middle CtrlArrowLeft","key":"CtrlArrowLeft","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":0}},
  {"name":"middle CtrlArrowRight","key":"CtrlArrowRight","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":4}},
  {"name":"middle PageUp","key":"PageUp","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":2,"col":2}},
  {"name":"middle PageDown","key":"PageDown","from":{"row":12,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":22,"col":2}},
  {"name":"top ArrowUp stays","key":"ArrowUp","from":{"row":0,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"bottom ArrowDown stays","key":"ArrowDown","from":{"row":24,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":24,"col":2}},
  {"name":"left ArrowLeft stays","key":"ArrowLeft","from":{"row":12,"col":0},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":0}},
  {"name":"right ArrowRight stays","key":"ArrowRight","from":{"row":12,"col":4},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":4}},
  {"name":"left Home stays","key":"Home","from":{"row":12,"col":0},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":0}},
  {"name":"right End stays","key":"End","from":{"row":12,"col":4},"rowCount":25,"columnCount":5,"expected":{"row":12,"col":4}},
  {"name":"first CtrlHome stays","key":"CtrlHome","from":{"row":0,"col":0},"rowCount":25,"columnCount":5,"expected":{"row":0,"col":0}},
  {"name":"last CtrlEnd stays","key":"CtrlEnd","from":{"row":24,"col":4},"rowCount":25,"columnCount":5,"expected":{"row":24,"col":4}},
  {"name":"top CtrlArrowUp stays","key":"CtrlArrowUp","from":{"row":0,"col":3},"rowCount":25,"columnCount":5,"expected":{"row":0,"col":3}},
  {"name":"bottom CtrlArrowDown stays","key":"CtrlArrowDown","from":{"row":24,"col":1},"rowCount":25,"columnCount":5,"expected":{"row":24,"col":1}},
  {"name":"left CtrlArrowLeft stays","key":"CtrlArrowLeft","from":{"row":10,"col":0},"rowCount":25,"columnCount":5,"expected":{"row":10,"col":0}},
  {"name":"right CtrlArrowRight stays","key":"CtrlArrowRight","from":{"row":10,"col":4},"rowCount":25,"columnCount":5,"expected":{"row":10,"col":4}},
  {"name":"near top PageUp clamps","key":"PageUp","from":{"row":3,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"near bottom PageDown clamps","key":"PageDown","from":{"row":22,"col":2},"rowCount":25,"columnCount":5,"expected":{"row":24,"col":2}},
  {"name":"one row ArrowUp","key":"ArrowUp","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"one row ArrowDown","key":"ArrowDown","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"one row PageUp","key":"PageUp","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"one row PageDown","key":"PageDown","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"one row CtrlArrowUp","key":"CtrlArrowUp","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"one row CtrlArrowDown","key":"CtrlArrowDown","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":2}},
  {"name":"one row Home","key":"Home","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":0}},
  {"name":"one row CtrlEnd","key":"CtrlEnd","from":{"row":0,"col":2},"rowCount":1,"columnCount":5,"expected":{"row":0,"col":4}},
  {"name":"one column ArrowLeft","key":"ArrowLeft","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":12,"col":0}},
  {"name":"one column ArrowRight","key":"ArrowRight","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":12,"col":0}},
  {"name":"one column Home","key":"Home","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":12,"col":0}},
  {"name":"one column End","key":"End","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":12,"col":0}},
  {"name":"one column CtrlArrowLeft","key":"CtrlArrowLeft","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":12,"col":0}},
  {"name":"one column CtrlArrowRight","key":"CtrlArrowRight","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":12,"col":0}},
  {"name":"one column CtrlHome","key":"CtrlHome","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":0,"col":0}},
  {"name":"one column CtrlEnd","key":"CtrlEnd","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":24,"col":0}},
  {"name":"one column PageUp","key":"PageUp","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":2,"col":0}},
  {"name":"one column PageDown","key":"PageDown","from":{"row":12,"col":0},"rowCount":25,"columnCount":1,"expected":{"row":22,"col":0}},
];

test("MIG-0737 U01 navigation pure: all 46 CURRENT movement vectors retain their exact coordinates", () => {
  const before = JSON.stringify(navigationParityCases);
  const actual = navigationParityCases.map(scenario => ({
    name: scenario.name,
    position: moveSpreadsheetFocus(scenario.from, scenario.key, scenario.rowCount, scenario.columnCount),
  }));
  assert.deepEqual(actual, navigationParityCases.map(scenario => ({
    name: scenario.name, position: scenario.expected,
  })));
  assert.equal(JSON.stringify(navigationParityCases), before, "navigation never mutates input positions");
});

test("MIG-0737 U01 navigation pure: new jump keys retain the existing invalid-dimension fence", () => {
  const position = { row: 2, col: 1 };
  for (const [rows, columns] of [[0, 5], [5, 0], [-1, 5], [NaN, 5], [Infinity, 5], [5, 1.5]]) {
    for (const key of ["CtrlHome", "CtrlEnd", "CtrlArrowUp", "CtrlArrowDown", "CtrlArrowLeft",
      "CtrlArrowRight", "PageUp", "PageDown"]) {
      assert.deepEqual(moveSpreadsheetFocus(position, key, rows, columns), position, key);
    }
  }
});

test("MIG-0737 U01 navigation pure: Enter, editing and unknown keys remain outside this helper scope", () => {
  const position = { row: 2, col: 1 };
  for (const key of ["Enter", "F2", "a", "Dead", "Homebrew", "ArrowOther"]) {
    assert.deepEqual(moveSpreadsheetFocus(position, key, 25, 5), position, key);
  }
});

test("MIG-0737 U01 Tab navigation pure: moves one column, clamps without wrapping and keeps the row", () => {
  for (let rows = 1; rows <= 5; rows++) {
    for (let columns = 1; columns <= 5; columns++) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const from = Object.freeze({ row, col });
          assert.deepEqual(moveSpreadsheetFocus(from, "Tab", rows, columns),
            { row, col: Math.min(columns - 1, col + 1) });
          assert.deepEqual(moveSpreadsheetFocus(from, "ShiftTab", rows, columns),
            { row, col: Math.max(0, col - 1) });
        }
      }
    }
  }
});

test("MIG-0737 U01 Tab navigation pure: invalid dimensions retain the input", () => {
  const from = { row: 2, col: 1 };
  for (const [rows, columns] of [[0, 4], [4, 0], [-1, 4], [NaN, 4], [Infinity, 4], [4, 1.5]]) {
    for (const key of ["Tab", "ShiftTab"]) assert.equal(moveSpreadsheetFocus(from, key, rows, columns), from);
  }
});

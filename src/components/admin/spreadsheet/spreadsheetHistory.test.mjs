import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyHistoryStacks,
  createHistoryEntry,
  popRedo,
  popUndo,
  pushUndoEntry,
  SPREADSHEET_HISTORY_MAX,
  valuesEqual,
} from "./spreadsheetHistory.ts";

test("pushUndoEntry clears redo and caps at max", () => {
  let stacks = createEmptyHistoryStacks();
  const entry = (i) =>
    createHistoryEntry({
      label: `e${i}`,
      table: "t",
      page: 1,
      changes: [],
    });

  for (let i = 0; i < SPREADSHEET_HISTORY_MAX + 5; i++) {
    stacks = pushUndoEntry(stacks, entry(i), SPREADSHEET_HISTORY_MAX);
  }
  assert.equal(stacks.undo.length, SPREADSHEET_HISTORY_MAX);
  assert.equal(stacks.undo[0]?.label, "e5");
  assert.equal(stacks.redo.length, 0);
});

test("undo/redo roundtrip", () => {
  let stacks = createEmptyHistoryStacks();
  const e1 = createHistoryEntry({
    label: "a",
    table: "t",
    page: 1,
    changes: [],
  });
  stacks = pushUndoEntry(stacks, e1);
  const u = popUndo(stacks);
  stacks = u.stacks;
  assert.equal(u.entry?.label, "a");
  assert.equal(stacks.redo.length, 1);
  const r = popRedo(stacks);
  stacks = r.stacks;
  assert.equal(r.entry?.label, "a");
  assert.equal(stacks.undo.length, 1);
});

test("valuesEqual treats empty and null same", () => {
  assert.equal(valuesEqual(null, ""), true);
  assert.equal(valuesEqual("a", "a"), true);
  assert.equal(valuesEqual("a", "b"), false);
});

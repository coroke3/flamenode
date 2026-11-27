import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { JSDOM } from "jsdom";
import { AdminSpreadsheetEditableGrid } from "../.test-dist/apps/ops/src/routes/admin/AdminSpreadsheetEditableGrid.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/spreadsheet",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const data = {
  def: { table: "videos", label: "動画", group: "content", mode: "editable" },
  columns: [
    { name: "id", type: "TEXT", editable: false, pk: 1, notNull: true },
    { name: "title", type: "TEXT", editable: true, pk: 0, notNull: false },
  ],
  primaryKeys: ["id"],
  rows: [{ id: "a1", title: "Alpha" }, { id: "b2", title: "Beta" }],
  page: 1, limit: 50, hasMore: false,
};
async function mount(props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let currentProps = {
    data, onRefresh: () => {}, fetchFn: async () => { throw Error("unexpected mutation"); },
    ...props,
  };
  const render = async (next = {}) => {
    currentProps = { ...currentProps, ...next };
    await React.act(async () => root.render(React.createElement(AdminSpreadsheetEditableGrid, currentProps)));
  };
  await render();
  return { host, render, cleanup: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}
async function press(cell, key, options = {}) {
  const event = new dom.window.KeyboardEvent("keydown", {
    key, bubbles: true, cancelable: true, ...options,
  });
  await React.act(async () => { cell.dispatchEvent(event); });
  return event;
}
async function flush() {
  await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
}

test("MIG-0737 U01: read-only grid keyboard shift-range copies selected TSV, no mutation", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (body) => { copied.push(body); },
  } });
  const ui = await mount();
  try {
    const first = ui.host.querySelector('[data-grid-cell="0:0"]');
    assert.ok(first);
    first.focus();
    await press(first, "ArrowRight");
    const second = ui.host.querySelector('[data-grid-cell="0:1"]');
    assert.equal(document.activeElement, second);
    assert.equal(second.tabIndex, 0);
    await press(second, "ArrowDown", { shiftKey: true });
    const last = ui.host.querySelector('[data-grid-cell="1:1"]');
    assert.equal(document.activeElement, last);
    assert.equal(last.getAttribute("aria-selected"), "true");
    await press(last, "c", { ctrlKey: true });
    await flush();
    assert.deepEqual(copied, ["Alpha\nBeta"]);
    assert.match(ui.host.textContent, /選択範囲をコピーしました/);
    assert.equal(ui.host.querySelectorAll("[data-grid-cell] input").length, 0);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

test("MIG-0737 U01: Enter navigates, edit buttons open only mutable columns; missing clipboard permission is reported", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async () => { throw Error("permission denied"); },
  } });
  const ui = await mount({ allowMutations: true });
  try {
    const pk = ui.host.querySelector('[data-grid-cell="0:0"]');
    assert.equal((await press(pk, "Enter")).defaultPrevented, true);
    assertNavigation(ui, "1:0");
    assert.equal(ui.host.querySelectorAll('button[aria-label="1行 id を編集"]').length, 0);
    assert.equal(ui.host.querySelectorAll("[data-grid-cell] input").length, 0);
    const title = ui.host.querySelector('[data-grid-cell="0:1"]');
    assert.equal((await press(title, "Enter")).defaultPrevented, true);
    assertNavigation(ui, "1:1");
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    await openCellEditor(title);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 1);
    // A TD event delivered while the child editor owns the draft is ignored.
    assert.equal((await press(title, "c", { ctrlKey: true })).defaultPrevented, false);
    await flush();
    assert.doesNotMatch(ui.host.textContent, /コピーが許可されていません/);
    assert.equal(title.querySelector("input").value, "Alpha");
    await clickButton(ui, "キャンセル");
    assert.equal((await press(title, "c", { ctrlKey: true })).defaultPrevented, true);
    await flush();
    assert.match(ui.host.textContent, /コピーが許可されていません/);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

const rangeData = {
  ...data,
  columns: [...data.columns, { name: "note", type: "TEXT", editable: false, pk: 0, notNull: false }],
  rows: [
    { id: "a1", title: "Alpha", note: "first" },
    { id: "b2", title: "Beta", note: "second" },
    { id: "c3", title: "Gamma", note: "third" },
  ],
  page: 2, limit: 3, hasMore: true,
};
const pageCells = ["0:0", "0:1", "0:2", "1:0", "1:1", "1:2", "2:0", "2:1", "2:2"];
const rowCells = ["1:0", "1:1", "1:2"];
const columnCells = ["0:1", "1:1", "2:1"];
const pageTsv = "a1\tAlpha\tfirst\nb2\tBeta\tsecond\nc3\tGamma\tthird";
const rowTsv = "b2\tBeta\tsecond";
const columnTsv = "Alpha\nBeta\nGamma";

function gridCell(ui, position) {
  const cell = ui.host.querySelector(`[data-grid-cell="${position}"]`);
  assert.ok(cell, "missing cell " + position);
  return cell;
}
function selectedCells(ui) {
  return [...ui.host.querySelectorAll('[aria-selected="true"]')].map(cell => cell.dataset.gridCell);
}
async function clickCellTarget(target) {
  await React.act(async () => {
    const down = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1 });
    target.dispatchEvent(down);
    // JSDOM does not execute the browser's default mousedown focus action.
    if (!down.defaultPrevented) target.closest("[data-grid-cell]")?.focus();
    target.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
  });
}
async function selectCell(ui, position) {
  const cell = gridCell(ui, position);
  await clickCellTarget(cell);
  return cell;
}
async function clickButton(ui, text) {
  const button = [...ui.host.querySelectorAll("button")].find(button =>
    button.textContent === text || button.getAttribute("aria-label") === text);
  assert.ok(button, "missing button " + text);
  assert.equal(button.disabled, false);
  await React.act(async () => { button.click(); });
}
async function openCellEditor(cell) {
  const button = cell.querySelector("button");
  assert.ok(button, "missing cell edit control");
  assert.equal(button.disabled, false);
  await React.act(async () => button.click());
}
async function beginTitleSave(ui, value) {
  const cell = await selectCell(ui, "1:1");
  await openCellEditor(cell);
  const input = cell.querySelector("input");
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await clickButton(ui, "セルを保存");
  return cell;
}
const successfulWrite = () => new Response(JSON.stringify({ ok: true }), {
  headers: { "content-type": "application/json" },
});

test("MIG-0737 U01: batched arrows preserve the anchor established by the preceding move", async () => {
  const ui = await mount({ data: rangeData });
  try {
    const first = await selectCell(ui, "0:0");
    await React.act(async () => {
      first.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown", shiftKey: true, bubbles: true,
      }));
    });
    assert.deepEqual(selectedCells(ui), ["0:1", "1:1"]);
    assert.equal(document.activeElement?.getAttribute("data-grid-cell"), "1:1");
  } finally { await ui.cleanup(); }
});

for (const scenario of [
  { name: "Ctrl+A with mutations off", key: "a", modifiers: { ctrlKey: true },
    cells: pageCells, tsv: pageTsv, end: "2:2", next: "2:1", allowMutations: false },
  { name: "Cmd+A on a readonly table", key: "a", modifiers: { metaKey: true },
    cells: pageCells, tsv: pageTsv, end: "2:2", next: "2:1", mode: "readonly" },
  { name: "Shift+Space", key: " ", modifiers: { shiftKey: true },
    cells: rowCells, tsv: rowTsv, end: "1:2", next: "1:1" },
  { name: "Ctrl+Space", key: " ", modifiers: { ctrlKey: true },
    cells: columnCells, tsv: columnTsv, end: "2:1", next: "1:1", arrow: "ArrowUp" },
  { name: "Cmd+Space", key: " ", modifiers: { metaKey: true },
    cells: columnCells, tsv: columnTsv, end: "2:1", next: "1:1", arrow: "ArrowUp" },
  { name: "Ctrl+Shift+Space row precedence", key: " ", modifiers: { ctrlKey: true, shiftKey: true },
    cells: rowCells, tsv: rowTsv, end: "1:2", next: "1:1" },
  { name: "Cmd+Shift+Space row precedence", key: " ", modifiers: { metaKey: true, shiftKey: true },
    cells: rowCells, tsv: rowTsv, end: "1:2", next: "1:1" },
  { name: "CURRENT Ctrl+Alt+A", key: "a", modifiers: { ctrlKey: true, altKey: true },
    cells: pageCells, tsv: pageTsv, end: "2:2", next: "2:1" },
  { name: "CURRENT Alt+Shift+Space", key: " ", modifiers: { altKey: true, shiftKey: true },
    cells: rowCells, tsv: rowTsv, end: "1:2", next: "1:1" },
]) {
  test(`MIG-0737 U01: ${scenario.name} selects current-page cells and moves from the endpoint`, async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (body) => { copied.push(body); },
    } });
    let calls = 0;
    let refreshes = 0;
    const ui = await mount({
      data: { ...rangeData, def: { ...rangeData.def, mode: scenario.mode ?? "editable" } },
      allowMutations: scenario.allowMutations ?? true,
      fetchFn: async () => { calls++; throw Error("selection must not fetch or mutate"); },
      onRefresh: () => { refreshes++; },
    });
    try {
      const start = await selectCell(ui, "1:1");
      const event = await press(start, scenario.key, scenario.modifiers);
      assert.equal(event.defaultPrevented, true);
      assert.deepEqual(selectedCells(ui), scenario.cells);
      const end = gridCell(ui, scenario.end);
      assert.equal(document.activeElement, end);
      assert.deepEqual([...ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]')], [end]);
      await press(end, "c", { ctrlKey: true });
      assert.deepEqual(copied, [scenario.tsv]);
      await press(end, scenario.arrow ?? "ArrowLeft");
      assert.deepEqual(selectedCells(ui), [scenario.next]);
      assert.equal(document.activeElement, gridCell(ui, scenario.next));
      assert.equal(calls, 0);
      assert.equal(refreshes, 0);
      assert.equal(ui.host.querySelectorAll("[data-grid-cell] input").length, 0);
    } finally {
      await ui.cleanup();
      if (previous) Object.defineProperty(navigator, "clipboard", previous);
      else delete navigator.clipboard;
    }
  });
}

test("MIG-0737 U01: selection shortcuts leave input and child-button keys to their owners", async () => {
  const ui = await mount({ data: rangeData, allowMutations: true });
  try {
    const cell = await selectCell(ui, "1:1");
    const button = cell.querySelector("button");
    assert.equal((await press(button, "a", { ctrlKey: true })).defaultPrevented, false);
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    await openCellEditor(cell);
    const input = cell.querySelector("input");
    assert.ok(input);
    for (const target of [input, cell]) {
      for (const [key, modifiers] of [
        ["a", { ctrlKey: true }], ["a", { metaKey: true }],
        [" ", { shiftKey: true }], [" ", { ctrlKey: true }],
      ]) {
        assert.equal((await press(target, key, modifiers)).defaultPrevented, false);
        assert.deepEqual(selectedCells(ui), ["1:1"]);
        assert.equal(cell.querySelector("input"), input);
        assert.equal(input.value, "Beta");
      }
    }
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: same-turn duplicate undo sends once and freezes range shortcuts until completion", async () => {
  const pending = [];
  let refreshes = 0;
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => pending.push({ resolve, init })),
    onRefresh: () => { refreshes++; },
  });
  try {
    const cell = await beginTitleSave(ui, "Changed");
    assert.equal(pending.length, 1);
    assert.equal(cell.querySelector("input") === null, true);
    assert.equal((await press(cell, "a", { ctrlKey: true })).defaultPrevented, true);
    assert.deepEqual(selectedCells(ui), pageCells);
    await selectCell(ui, "1:1");
    await React.act(async () => { pending[0].resolve(successfulWrite()); });
    await flush();
    assert.equal(cell.querySelector("input") === null, true);
    const immediateSelect = new dom.window.KeyboardEvent("keydown", {
      key: "a", ctrlKey: true, bubbles: true, cancelable: true,
    });
    await React.act(async () => {
      cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      cell.dispatchEvent(immediateSelect);
    });
    assert.equal(pending.length, 2);
    assert.equal(immediateSelect.defaultPrevented, false);
    for (const modifiers of [{ shiftKey: true }, { ctrlKey: true }]) {
      assert.equal((await press(cell, " ", modifiers)).defaultPrevented, false);
    }
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    await React.act(async () => { pending[1].resolve(successfulWrite()); });
    await flush();
    assert.equal((await press(cell, "a", { ctrlKey: true })).defaultPrevented, true);
    assert.deepEqual(selectedCells(ui), pageCells);
    assert.deepEqual(pending.map(request => JSON.parse(request.init.body).value), ["Changed", "Beta"]);
    assert.equal(refreshes, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: an old undo completion cannot unlock a newer transport's pending history", async () => {
  const oldRequests = [];
  const newRequests = [];
  let refreshes = 0;
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => oldRequests.push({ resolve, init })),
    onRefresh: () => { refreshes++; },
  });
  try {
    const oldCell = await beginTitleSave(ui, "Old transport");
    await React.act(async () => { oldRequests[0].resolve(successfulWrite()); });
    await flush();
    await press(oldCell, "z", { ctrlKey: true });
    assert.equal(oldRequests.length, 2);
    await ui.render({ fetchFn: (_, init) => new Promise(resolve => newRequests.push({ resolve, init })) });
    assert.equal(oldRequests[1].init.signal.aborted, true);
    const newCell = await beginTitleSave(ui, "New transport");
    await React.act(async () => { newRequests[0].resolve(successfulWrite()); });
    await flush();
    await press(newCell, "z", { metaKey: true });
    assert.equal(newRequests.length, 2);
    await React.act(async () => { oldRequests[1].resolve(successfulWrite()); });
    await flush();
    assert.equal(newRequests[1].init.signal.aborted, false);
    assert.equal((await press(newCell, "a", { ctrlKey: true })).defaultPrevented, false);
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    await React.act(async () => { newRequests[1].resolve(successfulWrite()); });
    await flush();
    assert.equal((await press(newCell, "a", { ctrlKey: true })).defaultPrevented, true);
    assert.deepEqual(selectedCells(ui), pageCells);
    assert.equal(refreshes, 3);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: an ordinary pending row deletion does not freeze range selection", async () => {
  let finish;
  let calls = 0;
  const ui = await mount({ data: rangeData, allowMutations: true, confirmDelete: () => true,
    fetchFn: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  });
  try {
    const cell = await selectCell(ui, "1:1");
    await clickButton(ui, "2行を削除");
    assert.equal(calls, 1);
    assert.equal((await press(cell, "a", { ctrlKey: true })).defaultPrevented, true);
    assert.deepEqual(selectedCells(ui), pageCells);
    await React.act(async () => { finish(successfulWrite()); });
    await flush();
    assert.equal(calls, 1);
  } finally { await ui.cleanup(); }
});

for (const [name, next] of [
  ["page", { data: { ...rangeData, page: 3 } }],
  ["table", { data: { ...rangeData, def: { ...rangeData.def, table: "songs" } } }],
  ["transport", { fetchFn: async () => { throw Error("unexpected request"); } }],
]) {
  test(`MIG-0737 U01: ${name} replacement resets the previous range`, async () => {
    const ui = await mount({ data: rangeData });
    try {
      const start = await selectCell(ui, "1:1");
      await press(start, "a", { ctrlKey: true });
      assert.deepEqual(selectedCells(ui), pageCells);
      await ui.render(next);
      assert.deepEqual(selectedCells(ui), ["0:0"]);
      const first = gridCell(ui, "0:0");
      assert.deepEqual([...ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]')], [first]);
      assert.equal(document.activeElement?.getAttribute("data-grid-cell"), "0:0");
      await press(document.activeElement, "ArrowRight");
      assert.deepEqual(selectedCells(ui), ["0:1"]);
    } finally { await ui.cleanup(); }
  });
}

const allHeader = "[data-grid-all-header]";
const rowHeader = index => `[data-grid-row-header="${index}"]`;
const columnHeader = index => `[data-grid-column-header="${index}"]`;
function gridHeader(ui, selector) {
  const header = ui.host.querySelector(selector);
  assert.ok(header, "missing header " + selector);
  return header;
}
function headerEvent(options = {}) {
  return new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, ...options });
}
async function pressHeader(ui, selector, options = {}) {
  const event = headerEvent(options);
  await React.act(async () => { gridHeader(ui, selector).dispatchEvent(event); });
  assert.equal(event.defaultPrevented, true);
}

for (const scenario of [
  { name: "corner with mutations off", selector: allHeader, cells: pageCells, tsv: pageTsv,
    end: "2:2", next: "2:1", allowMutations: false },
  { name: "row ignoring Ctrl/Meta/Alt", selector: rowHeader(1), cells: rowCells, tsv: rowTsv,
    end: "1:2", next: "1:1", options: { ctrlKey: true, metaKey: true, altKey: true } },
  { name: "readonly column from outside focus", selector: columnHeader(1), cells: columnCells, tsv: columnTsv,
    end: "2:1", next: "1:1", arrow: "ArrowUp", mode: "readonly", externalFocus: true },
]) {
  test(`MIG-0737 U01 header: ${scenario.name} selects only page data for TSV and following arrows`, async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async body => { copied.push(body); },
    } });
    let calls = 0;
    let refreshes = 0;
    const ui = await mount({ data: { ...rangeData, def: { ...rangeData.def, mode: scenario.mode ?? "editable" } },
      allowMutations: scenario.allowMutations ?? true,
      fetchFn: async () => { calls++; throw Error("header selection must not send"); },
      onRefresh: () => { refreshes++; },
    });
    const outside = document.createElement("input");
    document.body.append(outside);
    try {
      await selectCell(ui, "1:1");
      if (scenario.externalFocus) outside.focus();
      await pressHeader(ui, scenario.selector, scenario.options);
      assert.deepEqual(selectedCells(ui), scenario.cells);
      assert.equal(document.activeElement?.getAttribute("data-grid-cell"), scenario.end);
      assert.deepEqual([...ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]')]
        .map(cell => cell.dataset.gridCell), [scenario.end]);
      assert.deepEqual([...ui.host.querySelectorAll('th[scope="row"]')].map(header => header.textContent), ["4", "5", "6"]);
      await press(document.activeElement, "c", { ctrlKey: true });
      assert.deepEqual(copied, [scenario.tsv]);
      await press(document.activeElement, scenario.arrow ?? "ArrowLeft");
      assert.deepEqual(selectedCells(ui), [scenario.next]);
      assert.equal(calls, 0);
      assert.equal(refreshes, 0);
    } finally {
      outside.remove();
      await ui.cleanup();
      if (previous) Object.defineProperty(navigator, "clipboard", previous);
      else delete navigator.clipboard;
    }
  });
}

for (const button of [1, 2]) {
  for (const scenario of [
    { name: "row", selector: rowHeader(0), cells: ["1:1"], end: "1:1" },
    { name: "column", selector: columnHeader(1), cells: columnCells, end: "2:1" },
    { name: "corner ignoring Shift", selector: allHeader, cells: pageCells, end: "2:2", shiftKey: true },
  ]) {
    test(`MIG-0737 U01 header: CURRENT button=${button} behavior for ${scenario.name}`, async () => {
      const ui = await mount({ data: rangeData });
      try {
        await selectCell(ui, "1:1");
        await pressHeader(ui, scenario.selector, { button, shiftKey: scenario.shiftKey });
        assert.deepEqual(selectedCells(ui), scenario.cells);
        assert.equal(document.activeElement?.getAttribute("data-grid-cell"), scenario.end);
      } finally { await ui.cleanup(); }
    });
  }
}

for (const scenario of [
  { name: "row forward", start: "1:1", selector: rowHeader(2), cells: ["1:1", "1:2", "2:1", "2:2"], end: "2:2" },
  { name: "row backward", start: "2:1", selector: rowHeader(0), cells: ["0:1", "0:2", "1:1", "1:2", "2:1", "2:2"], end: "0:2" },
  { name: "column forward", start: "1:0", selector: columnHeader(2), cells: ["1:0", "1:1", "1:2", "2:0", "2:1", "2:2"], end: "2:2" },
  { name: "column backward", start: "1:2", selector: columnHeader(0), cells: ["1:0", "1:1", "1:2", "2:0", "2:1", "2:2"], end: "2:0" },
]) {
  test(`MIG-0737 U01 header: Shift ${scenario.name} extends the original cell anchor`, async () => {
    const ui = await mount({ data: rangeData });
    try {
      await selectCell(ui, scenario.start);
      await pressHeader(ui, scenario.selector, { shiftKey: true });
      assert.deepEqual(selectedCells(ui), scenario.cells);
      assert.equal(document.activeElement?.getAttribute("data-grid-cell"), scenario.end);
    } finally { await ui.cleanup(); }
  });
}

for (const scenario of [
  { name: "row", first: rowHeader(1), second: rowHeader(2), cells: ["1:0", "1:1", "1:2", "2:0", "2:1", "2:2"] },
  { name: "column", first: columnHeader(1), second: columnHeader(2), cells: ["0:1", "0:2", "1:1", "1:2", "2:1", "2:2"] },
]) {
  test(`MIG-0737 U01 header: batched ${scenario.name} presses retain the newly established anchor`, async () => {
    const ui = await mount({ data: rangeData });
    try {
      await selectCell(ui, "0:0");
      await React.act(async () => {
        gridHeader(ui, scenario.first).dispatchEvent(headerEvent());
        gridHeader(ui, scenario.second).dispatchEvent(headerEvent({ shiftKey: true }));
      });
      assert.deepEqual(selectedCells(ui), scenario.cells);
      assert.equal(document.activeElement?.getAttribute("data-grid-cell"), "2:2");
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 header: corner selection preserves an external control's focus", async () => {
  const ui = await mount({ data: rangeData });
  const outside = document.createElement("input");
  document.body.append(outside);
  try {
    outside.focus();
    await pressHeader(ui, allHeader, { shiftKey: true });
    assert.deepEqual(selectedCells(ui), pageCells);
    assert.equal(document.activeElement === outside, true);
    assert.equal(gridCell(ui, "2:2").tabIndex, 0);
  } finally { outside.remove(); await ui.cleanup(); }
});

test("MIG-0737 U01 header: the interim editor fence retains an unsaved draft and its focus", async () => {
  let calls = 0;
  let refreshes = 0;
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { calls++; throw Error("header must not commit an active draft"); },
    onRefresh: () => { refreshes++; },
  });
  try {
    const cell = await selectCell(ui, "1:1");
    await openCellEditor(cell);
    const input = cell.querySelector("input");
    await React.act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "Unsaved draft");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    for (const selector of [allHeader, rowHeader(0), columnHeader(0)]) {
      for (const shiftKey of [false, true]) {
        await pressHeader(ui, selector, { shiftKey });
        assert.deepEqual(selectedCells(ui), ["1:1"]);
        assert.equal(document.activeElement === input, true);
        assert.equal(input.value, "Unsaved draft");
        assert.equal(cell.querySelector("input") === input, true);
      }
    }
    assert.match(ui.host.textContent, /セルを保存するかキャンセル/);
    assert.equal(calls, 0);
    assert.equal(refreshes, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 header: pointer selection remains available during history without bypassing its keyboard lock", async () => {
  const requests = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ resolve, init })),
  });
  try {
    const cell = await beginTitleSave(ui, "Changed");
    await React.act(async () => { requests[0].resolve(successfulWrite()); });
    await flush();
    await press(cell, "z", { ctrlKey: true });
    assert.equal(requests.length, 2);
    for (const [selector, expected] of [[rowHeader(1), rowCells], [columnHeader(1), columnCells], [allHeader, pageCells]]) {
      await pressHeader(ui, selector);
      assert.deepEqual(selectedCells(ui), expected);
      assert.equal((await press(document.activeElement, "a", { ctrlKey: true })).defaultPrevented, false);
      assert.deepEqual(selectedCells(ui), expected);
      assert.equal(requests.length, 2);
    }
    await React.act(async () => { requests[1].resolve(successfulWrite()); });
    await flush();
  } finally { await ui.cleanup(); }
});

for (const [name, empty] of [
  ["rows", { ...rangeData, rows: [] }],
  ["columns", { ...rangeData, columns: [] }],
  ["rows and columns", { ...rangeData, rows: [], columns: [] }],
]) {
  test(`MIG-0737 U01 header: empty ${name} has no selectable or focusable data range`, async () => {
    const ui = await mount({ data: empty });
    const outside = document.createElement("input");
    document.body.append(outside);
    try {
      outside.focus();
      const headers = [allHeader];
      if (empty.columns.length) headers.push(columnHeader(0));
      if (empty.rows.length) headers.push(rowHeader(0));
      for (const selector of headers) {
        await pressHeader(ui, selector, { shiftKey: true });
        assert.deepEqual(selectedCells(ui), []);
        assert.equal(document.activeElement === outside, true);
      }
      assert.equal(ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]').length, 0);
    } finally { outside.remove(); await ui.cleanup(); }
  });
}

function gridColumnWidth(ui, index) {
  const head = gridHeader(ui, columnHeader(index));
  const col = ui.host.querySelectorAll("colgroup col")[index + 1];
  assert.ok(col, "missing width column " + index);
  assert.equal(head.style.width, col.style.width);
  for (const cell of ui.host.querySelectorAll(`[data-grid-cell$=":${index}"]`)) {
    assert.equal(cell.style.width, col.style.width);
  }
  return Number.parseInt(col.style.width, 10);
}
function displayedValue(ui, position) {
  const span = gridCell(ui, position).querySelector("[data-grid-cell-content]");
  assert.ok(span, "missing displayed value " + position);
  return span;
}
function measureValue(ui, position, width) {
  Object.defineProperty(displayedValue(ui, position), "scrollWidth", { configurable: true, value: width });
}
async function startResize(ui, index, options = {}) {
  const handle = gridHeader(ui, columnHeader(index)).querySelector("[data-grid-column-resizer]");
  assert.ok(handle, "missing resize handle " + index);
  const event = headerEvent({ clientX: 100, ...options });
  await React.act(async () => handle.dispatchEvent(event));
  assert.equal(event.defaultPrevented, true);
}
async function moveResize(clientX) {
  await React.act(async () => window.dispatchEvent(new dom.window.MouseEvent("mousemove", { clientX })));
}
async function endResize() {
  await React.act(async () => window.dispatchEvent(new dom.window.MouseEvent("mouseup")));
}
async function autoFitColumn(ui, index) {
  const header = gridHeader(ui, columnHeader(index));
  // Dispatch the preceding presses too: a bare dblclick would miss header selection and the draft fence.
  for (let detail = 1; detail <= 2; detail++) {
    await React.act(async () => {
      header.dispatchEvent(headerEvent({ detail }));
      header.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, detail }));
      header.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail }));
    });
  }
  await React.act(async () => header.dispatchEvent(
    new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }),
  ));
}

test("MIG-0737 U01 column sizing: CURRENT letters, initial widths and automatic table layout", async () => {
  const columns = Array.from({ length: 53 }, (_, index) => ({
    name: "field_" + index, type: "TEXT", editable: false, pk: 0, notNull: false,
  }));
  const ui = await mount({ data: { ...data, columns, rows: [], primaryKeys: [] } });
  try {
    for (const [index, letter] of [[0, "A"], [25, "Z"], [26, "AA"], [27, "AB"], [51, "AZ"], [52, "BA"]]) {
      const header = gridHeader(ui, columnHeader(index));
      assert.equal(header.querySelector("[data-grid-column-letter]")?.textContent, letter);
      assert.equal(header.title, columns[index].name + " (TEXT)");
      assert.equal(gridColumnWidth(ui, index), 110);
    }
    const table = ui.host.querySelector("table");
    assert.notEqual(table.style.tableLayout, "fixed");
    assert.equal(table.style.width, "100%");
    assert.equal(table.style.minWidth, "max-content");
    assert.equal(table.style.borderCollapse, "separate");
    assert.equal(table.querySelector("col").style.width, "46px");
    assert.equal(table.querySelectorAll("col").length, columns.length + 2);
    assert.equal(table.querySelector("col:last-child").style.width, "");
    assert.equal(ui.host.querySelectorAll("[data-grid-column-letter]").length, 53);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 column sizing: drag clamps and starts from the last requested width without other effects", async () => {
  let calls = 0;
  let refreshes = 0;
  const ui = await mount({ data: rangeData,
    fetchFn: async () => { calls++; throw Error("resize must not send"); },
    onRefresh: () => { refreshes++; },
  });
  const outside = document.createElement("input");
  document.body.append(outside);
  try {
    await selectCell(ui, "1:1");
    outside.focus();
    const selected = selectedCells(ui);
    await startResize(ui, 1, { clientX: 200 });
    await moveResize(240);
    assert.equal(gridColumnWidth(ui, 1), 150);
    await moveResize(2000);
    assert.equal(gridColumnWidth(ui, 1), 420);
    await moveResize(-2000);
    assert.equal(gridColumnWidth(ui, 1), 56);
    await endResize();
    await moveResize(250);
    assert.equal(gridColumnWidth(ui, 1), 56);
    await startResize(ui, 1);
    await moveResize(125);
    assert.equal(gridColumnWidth(ui, 1), 81);
    await endResize();
    assert.equal(gridColumnWidth(ui, 0), 110);
    assert.equal(gridColumnWidth(ui, 2), 110);
    assert.deepEqual(selectedCells(ui), selected);
    assert.equal(document.activeElement, outside);
    assert.equal(calls, 0);
    assert.equal(refreshes, 0);
  } finally { outside.remove(); await ui.cleanup(); }
});

for (const button of [0, 1, 2]) {
  test(`MIG-0737 U01 column sizing: CURRENT resize button=${button} and modifier acceptance`, async () => {
    const ui = await mount({ data: rangeData });
    try {
      await selectCell(ui, "1:1");
      await startResize(ui, 2, { button, shiftKey: true, ctrlKey: true, metaKey: true, altKey: true });
      await moveResize(135);
      assert.equal(gridColumnWidth(ui, 2), 145);
      assert.deepEqual(selectedCells(ui), ["1:1"]);
      assert.equal(document.activeElement, gridCell(ui, "1:1"));
      await endResize();
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 column sizing: mounted replacement, reorder and removed names retain CURRENT drag and widths", async () => {
  const ui = await mount({ data: rangeData });
  try {
    await startResize(ui, 1);
    await moveResize(130);
    assert.equal(gridColumnWidth(ui, 1), 140);
    const next = { ...rangeData, page: 3, def: { ...rangeData.def, table: "songs" } };
    await ui.render({ data: next, allowMutations: true,
      fetchFn: async () => { throw Error("sizing must not send"); },
    });
    await moveResize(160);
    assert.equal(gridColumnWidth(ui, 1), 170);
    await ui.render({ data: { ...next, columns: [next.columns[2], next.columns[1], next.columns[0]] } });
    assert.equal(gridColumnWidth(ui, 1), 170);
    assert.equal(gridColumnWidth(ui, 0), 110);
    await ui.render({ data: { ...next, columns: next.columns.filter(c => c.name !== "title") } });
    await moveResize(200);
    await ui.render({ data: { ...next, columns: [next.columns[1], next.columns[0], next.columns[2]] } });
    assert.equal(gridColumnWidth(ui, 0), 210);
    await endResize();
    await ui.render({ data: rangeData });
    await moveResize(300);
    assert.equal(gridColumnWidth(ui, 1), 210);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 column sizing: CURRENT drag survives window blur and listeners are removed on unmount", async () => {
  const originalAdd = window.addEventListener;
  const originalRemove = window.removeEventListener;
  const listeners = new Map([["mousemove", new Set()], ["mouseup", new Set()]]);
  window.addEventListener = function(type, listener, options) {
    listeners.get(type)?.add(listener);
    return originalAdd.call(this, type, listener, options);
  };
  window.removeEventListener = function(type, listener, options) {
    listeners.get(type)?.delete(listener);
    return originalRemove.call(this, type, listener, options);
  };
  let ui;
  try {
    ui = await mount();
    await startResize(ui, 1);
    await moveResize(125);
    await React.act(async () => window.dispatchEvent(new dom.window.Event("blur")));
    await moveResize(150);
    assert.equal(gridColumnWidth(ui, 1), 160);
    assert.equal(listeners.get("mousemove").size, 1);
    assert.equal(listeners.get("mouseup").size, 1);
    await ui.cleanup();
    ui = null;
    assert.equal(listeners.get("mousemove").size, 0);
    assert.equal(listeners.get("mouseup").size, 0);
    await moveResize(300);
  } finally {
    if (ui) await ui.cleanup();
    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
  }
});

test("MIG-0737 U01 column sizing: autofit measures only displayed values in the current column and clamps", async () => {
  const ui = await mount({ data: rangeData, allowMutations: true });
  try {
    measureValue(ui, "0:1", 200);
    measureValue(ui, "1:1", 100);
    measureValue(ui, "0:2", 999);
    for (const node of ui.host.querySelectorAll("th, button")) {
      Object.defineProperty(node, "scrollWidth", { configurable: true, value: 2000 });
    }
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 216);
    assert.equal(gridColumnWidth(ui, 2), 110);
    assert.deepEqual(selectedCells(ui), columnCells);
    assert.equal(document.activeElement, gridCell(ui, "2:1"));
    await selectCell(ui, "1:0");
    const handle = gridHeader(ui, columnHeader(1)).querySelector("[data-grid-column-resizer]");
    measureValue(ui, "0:1", 240);
    for (let detail = 1; detail <= 2; detail++) {
      await React.act(async () => {
        handle.dispatchEvent(headerEvent({ detail }));
        handle.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, detail }));
        handle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail }));
      });
    }
    await React.act(async () => handle.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, detail: 2 })));
    assert.equal(gridColumnWidth(ui, 1), 256);
    assert.deepEqual(selectedCells(ui), ["1:0"]);
    assert.equal(document.activeElement, gridCell(ui, "1:0"));
    await moveResize(400);
    assert.equal(gridColumnWidth(ui, 1), 256);
    measureValue(ui, "0:1", 600);
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 420);
    await autoFitColumn(ui, 0);
    assert.equal(gridColumnWidth(ui, 0), 56);
    await ui.render({ data: { ...rangeData, rows: [] } });
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 56);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 column sizing: empty and null display spans with nonzero layout widths are excluded", async () => {
  const ui = await mount({ data: { ...rangeData, rows: [
    { id: "a", title: "" }, { id: "b", title: null }, { id: "c" },
  ] } });
  try {
    for (const position of ["0:1", "1:1", "2:1"]) measureValue(ui, position, 350);
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 56);
    await clickCellTarget(displayedValue(ui, "1:1"));
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    await ui.render({ data: { ...rangeData, rows: [
      { id: "a", title: " " }, { id: "b", title: 0 }, { id: "c", title: false },
    ] } });
    measureValue(ui, "0:1", 80);
    measureValue(ui, "1:1", 120);
    measureValue(ui, "2:1", 90);
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 136);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 column sizing: repeated autofit retains CURRENT measured-scroll-width behavior", async () => {
  const ui = await mount({ data });
  try {
    // A block's scrollWidth may track its current box; these supplied measurements are not native layout proof.
    const value = displayedValue(ui, "0:1");
    assert.equal(value.style.display, "block");
    assert.equal(value.style.padding, "2px 6px");
    assert.equal(value.style.maxWidth, "280px");
    assert.equal(value.style.whiteSpace, "nowrap");
    assert.equal(value.style.fontFamily, "var(--font-mono, ui-monospace, monospace)");
    Object.defineProperty(value, "scrollWidth", { configurable: true, get: () => gridColumnWidth(ui, 1) });
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 126);
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 142);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 column sizing: resize and autofit exclude the active input and preserve its draft and focus", async () => {
  let calls = 0;
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: async () => { calls++; throw Error("sizing must not save"); },
    onRefresh: () => { refreshes++; },
  });
  try {
    const cell = await selectCell(ui, "0:1");
    await openCellEditor(cell);
    const input = cell.querySelector("input");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "unsaved");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      input.focus();
    });
    Object.defineProperty(input, "scrollWidth", { configurable: true, value: 2000 });
    measureValue(ui, "1:1", 70);
    await startResize(ui, 1);
    await moveResize(145);
    assert.equal(gridColumnWidth(ui, 1), 155);
    await endResize();
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 86);
    assert.equal(cell.querySelector("input"), input);
    assert.equal(input.value, "unsaved");
    assert.equal(document.activeElement, input);
    assert.deepEqual(selectedCells(ui), ["0:1"]);
    assert.equal(calls, 0);
    assert.equal(refreshes, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 column sizing: value wrapper preserves range navigation and copied TSV", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async body => { copied.push(body); },
  } });
  const ui = await mount({ data: rangeData });
  try {
    await clickCellTarget(displayedValue(ui, "1:1"));
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    const cell = gridCell(ui, "1:1");
    assert.equal(cell.tabIndex, 0);
    await press(cell, "ArrowDown", { shiftKey: true });
    await press(document.activeElement, "c", { ctrlKey: true });
    assert.deepEqual(copied, ["Beta\nGamma"]);
    await startResize(ui, 1);
    await moveResize(180);
    await endResize();
    assert.deepEqual(copied, ["Beta\nGamma"]);
    await press(document.activeElement, "c", { ctrlKey: true });
    assert.deepEqual(copied, ["Beta\nGamma", "Beta\nGamma"]);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

test("MIG-0737 U01 column sizing: pending save and history keep their requests and receipts during sizing", async () => {
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ resolve, init })),
    onRefresh: () => { refreshes++; },
  });
  try {
    const cell = await beginTitleSave(ui, "Changed");
    assert.equal(requests.length, 1);
    await startResize(ui, 1);
    await moveResize(130);
    await endResize();
    assert.equal(gridColumnWidth(ui, 1), 140);
    measureValue(ui, "0:1", 170);
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 186);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.signal.aborted, false);
    assert.equal(refreshes, 0);
    await React.act(async () => requests[0].resolve(successfulWrite()));
    await flush();
    assert.equal(refreshes, 1);
    await press(cell, "z", { ctrlKey: true });
    assert.equal(requests.length, 2);
    await startResize(ui, 1);
    await moveResize(110);
    await endResize();
    assert.equal(gridColumnWidth(ui, 1), 196);
    await autoFitColumn(ui, 1);
    assert.equal(gridColumnWidth(ui, 1), 186);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].init.signal.aborted, false);
    assert.equal((await press(document.activeElement, "a", { ctrlKey: true })).defaultPrevented, false);
    await React.act(async () => requests[1].resolve(successfulWrite()));
    await flush();
    assert.equal(refreshes, 2);
    assert.equal(requests.length, 2);
    assert.match(ui.host.textContent, /保存しました/);
  } finally { await ui.cleanup(); }
});


const navigationData = {
  ...rangeData,
  columns: [...rangeData.columns,
    { name: "extra", type: "TEXT", editable: false, pk: 0, notNull: false },
    { name: "last", type: "TEXT", editable: false, pk: 0, notNull: false }],
  rows: Array.from({ length: 25 }, (_, index) => ({
    id: "r" + (index + 1), title: "Title" + (index + 1), note: "n" + (index + 1),
    extra: "x" + (index + 1), last: "z" + (index + 1),
  })),
  page: 7, limit: 25, hasMore: true,
};
function watchNavigationScroll(ui) {
  const calls = [];
  for (const node of ui.host.querySelectorAll("[data-grid-cell]")) {
    node.scrollIntoView = options => calls.push({ position: node.dataset.gridCell, options });
  }
  return calls;
}
function assertNavigation(ui, focus, selection = [focus]) {
  assert.deepEqual(selectedCells(ui), selection);
  assert.ok(document.activeElement === gridCell(ui, focus), "expected navigation DOM focus at " + focus);
  assert.deepEqual([...ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]')]
    .map(node => node.dataset.gridCell), [focus]);
}
async function selectNavigationRange(ui, anchor, focus) {
  await selectCell(ui, anchor);
  const target = gridCell(ui, focus);
  await React.act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent("mousedown", {
      bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, shiftKey: true,
    }));
    target.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
  });
}

test("MIG-0737 U01 navigation: ordinary and Alt arrow/Home/End keys move and reveal their TD", async () => {
  const effects = [];
  const ui = await mount({ data: navigationData,
    fetchFn: async () => { effects.push("request"); throw Error("navigation must not request"); },
    onRefresh: () => { effects.push("refresh"); },
  });
  const scrolls = watchNavigationScroll(ui);
  try {
    for (const [key, options, end] of [
      ["ArrowUp", {}, "11:2"], ["ArrowDown", { altKey: true }, "13:2"],
      ["ArrowLeft", { altKey: true }, "12:1"], ["ArrowRight", {}, "12:3"],
      ["Home", { altKey: true }, "12:0"], ["End", {}, "12:4"],
    ]) {
      await selectCell(ui, "12:2");
      scrolls.length = 0;
      assert.equal((await press(document.activeElement, key, options)).defaultPrevented, true, key);
      assertNavigation(ui, end);
      assert.deepEqual(scrolls, [{ position: end, options: { block: "nearest", inline: "nearest" } }], key);
    }
    assert.deepEqual(effects, []);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: Ctrl and Cmd extremes retain Alt and collapse modified Shift ranges", async () => {
  const effects = [];
  const ui = await mount({ data: navigationData,
    fetchFn: async () => { effects.push("request"); throw Error("navigation must not request"); },
    onRefresh: () => { effects.push("refresh"); },
  });
  const scrolls = watchNavigationScroll(ui);
  try {
    for (const [key, options, end] of [
      ["Home", { ctrlKey: true }, "0:0"], ["End", { metaKey: true }, "24:4"],
      ["ArrowUp", { ctrlKey: true, altKey: true }, "0:2"],
      ["ArrowDown", { metaKey: true }, "24:2"],
      ["ArrowLeft", { ctrlKey: true, metaKey: true, shiftKey: true }, "12:0"],
      ["ArrowRight", { metaKey: true, altKey: true, shiftKey: true }, "12:4"],
      ["Home", { metaKey: true, altKey: true, shiftKey: true }, "0:0"],
      ["End", { ctrlKey: true, altKey: true, shiftKey: true }, "24:4"],
    ]) {
      await selectNavigationRange(ui, "12:0", "12:2");
      scrolls.length = 0;
      assert.equal((await press(document.activeElement, key, options)).defaultPrevented, true, key);
      assertNavigation(ui, end);
      assert.deepEqual(scrolls, [{ position: end, options: { block: "nearest", inline: "nearest" } }], key);
    }
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: Page keys move ten displayed rows without requesting another data page", async () => {
  const effects = [];
  const ui = await mount({ data: navigationData,
    fetchFn: async () => { effects.push("request"); throw Error("Page keys must not load a page"); },
    onRefresh: () => { effects.push("refresh"); },
  });
  const scrolls = watchNavigationScroll(ui);
  try {
    for (const [key, options, end] of [
      ["PageUp", {}, "2:2"], ["PageDown", {}, "22:2"],
      ["PageUp", { ctrlKey: true, metaKey: true, altKey: true, shiftKey: true }, "2:2"],
      ["PageDown", { metaKey: true, altKey: true, shiftKey: true }, "22:2"],
    ]) {
      await selectNavigationRange(ui, "12:0", "12:2");
      scrolls.length = 0;
      assert.equal((await press(document.activeElement, key, options)).defaultPrevented, true, key);
      assertNavigation(ui, end);
      assert.deepEqual(scrolls, [{ position: end, options: { block: "nearest", inline: "nearest" } }], key);
      assert.equal(ui.host.querySelector('[data-grid-row-header="0"]').textContent, "151");
    }
    await press(document.activeElement, "PageDown");
    assertNavigation(ui, "24:2");
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: boundary keys consume without scrolling, including same-coordinate collapse", async () => {
  const ui = await mount({ data: navigationData });
  const scrolls = watchNavigationScroll(ui);
  try {
    for (const scenario of [
      { key: "ArrowUp", start: "0:2" }, { key: "ArrowDown", start: "24:2" },
      { key: "ArrowLeft", start: "12:0" }, { key: "ArrowRight", start: "12:4" },
      { key: "Home", start: "12:0" }, { key: "End", start: "12:4" },
      { key: "PageUp", start: "0:2" }, { key: "PageDown", start: "24:2" },
      { key: "Home", start: "0:0", options: { ctrlKey: true } },
      { key: "End", start: "24:4", options: { metaKey: true } },
      { key: "End", anchor: "12:1", start: "12:4", options: { shiftKey: true } },
      { key: "ArrowUp", anchor: "1:2", start: "0:2", options: { shiftKey: true }, selected: ["0:2", "1:2"] },
      { key: "ArrowUp", anchor: "1:2", start: "0:2", options: { ctrlKey: true, shiftKey: true } },
    ]) {
      if (scenario.anchor) await selectNavigationRange(ui, scenario.anchor, scenario.start);
      else await selectCell(ui, scenario.start);
      scrolls.length = 0;
      assert.equal((await press(document.activeElement, scenario.key, scenario.options)).defaultPrevented, true, scenario.key);
      assertNavigation(ui, scenario.start, scenario.selected);
      assert.deepEqual(scrolls, [], "same coordinates do not cause a scroll");
    }
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: only unmodified-classified Shift arrows extend the original anchor", async () => {
  const ui = await mount({ data: navigationData });
  try {
    for (const [key, options, end, selected] of [
      ["Home", { shiftKey: true }, "12:0"], ["End", { shiftKey: true }, "12:4"],
      ["PageUp", { shiftKey: true }, "2:2"], ["PageDown", { shiftKey: true }, "22:2"],
      ["ArrowUp", { ctrlKey: true, shiftKey: true }, "0:2"],
      ["ArrowDown", { metaKey: true, shiftKey: true, altKey: true }, "24:2"],
      ["ArrowLeft", { altKey: true, shiftKey: true }, "12:1", ["12:0", "12:1"]],
      ["ArrowRight", { shiftKey: true }, "12:3", ["12:0", "12:1", "12:2", "12:3"]],
      ["ArrowUp", { altKey: true, shiftKey: true }, "11:2",
        ["11:0", "11:1", "11:2", "12:0", "12:1", "12:2"]],
      ["ArrowDown", { altKey: true, shiftKey: true }, "13:2",
        ["12:0", "12:1", "12:2", "13:0", "13:1", "13:2"]],
    ]) {
      await selectNavigationRange(ui, "12:0", "12:2");
      assert.equal((await press(document.activeElement, key, options)).defaultPrevented, true, key);
      assertNavigation(ui, end, selected);
    }
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: batched jump then Shift arrow retain the roving endpoint, status and TSV", async () => {
  // Preserve TARGET's established TD-coordinate batching adaptation; CURRENT's viewport reads committed state.
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async text => { copied.push(text); },
  } });
  const ui = await mount({ data: navigationData });
  const scrolls = watchNavigationScroll(ui);
  try {
    await selectCell(ui, "12:2");
    scrolls.length = 0;
    await React.act(async () => {
      document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "End", ctrlKey: true, bubbles: true, cancelable: true,
      }));
      document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "ArrowUp", shiftKey: true, bubbles: true, cancelable: true,
      }));
    });
    assertNavigation(ui, "23:4", ["23:4", "24:4"]);
    assert.deepEqual(scrolls.at(-1), { position: "23:4", options: { block: "nearest", inline: "nearest" } });
    assert.equal(ui.host.querySelector("[data-spreadsheet-grid-status]").firstElementChild.textContent, "2 セル · 入力 2");
    assert.deepEqual(copied, []);
    await press(document.activeElement, "c", { ctrlKey: true });
    assert.deepEqual(copied, ["z24\nz25"]);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

test("MIG-0737 U01 navigation: readonly, default-off and missing-PK grids still navigate without writes", async () => {
  for (const variant of [
    { mode: "readonly", allowMutations: true, primaryKeys: ["id"] },
    { mode: "editable", allowMutations: false, primaryKeys: ["id"] },
    { mode: "editable", allowMutations: true, primaryKeys: [] },
  ]) {
    const effects = [];
    const ui = await mount({ data: { ...navigationData, def: { ...navigationData.def, mode: variant.mode },
      primaryKeys: variant.primaryKeys }, allowMutations: variant.allowMutations,
    fetchFn: async () => { effects.push("request"); throw Error("navigation must not write"); },
    onRefresh: () => { effects.push("refresh"); } });
    try {
      await selectCell(ui, "12:2");
      assert.equal((await press(document.activeElement, "Home", { metaKey: true })).defaultPrevented, true);
      assertNavigation(ui, "0:0");
      await press(document.activeElement, "PageDown");
      assertNavigation(ui, "10:0");
      assert.equal(ui.host.querySelectorAll('button[aria-label="1行 title を編集"]').length, 0);
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
      assert.deepEqual(effects, []);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01 navigation: live and invalidated drafts keep their value and navigation fence", async () => {
  const effects = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("draft must not save"); },
    onRefresh: () => { effects.push("refresh"); },
  });
  try {
    const cell = await selectCell(ui, "1:1");
    await openCellEditor(cell);
    const input = cell.querySelector("input");
    assert.ok(input);
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "Unsaved draft");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    for (const [key, options] of [["Home", {}], ["PageDown", {}], ["ArrowRight", { altKey: true }], ["End", { ctrlKey: true }]]) {
      assert.equal((await press(cell, key, options)).defaultPrevented, false, key);
      assert.deepEqual(selectedCells(ui), ["1:1"]);
      assert.ok(document.activeElement === input, "live draft retains focus");
      assert.equal(input.value, "Unsaved draft");
    }
    await ui.render({ data: { ...rangeData, rows: [rangeData.rows[0], { ...rangeData.rows[1], title: "Server change" }, rangeData.rows[2]] } });
    assert.ok(cell.querySelector("input") === null, "invalidated draft is not rendered");
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    const active = document.activeElement;
    for (const key of ["Home", "End", "PageUp", "PageDown"]) {
      assert.equal((await press(cell, key)).defaultPrevented, false, key);
      assert.deepEqual(selectedCells(ui), ["1:1"]);
      assert.ok(document.activeElement === active, "invalidated draft does not take focus");
    }
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: an edit started in the same batch fences the following TD key", async () => {
  const ui = await mount({ data: rangeData, allowMutations: true });
  try {
    const cell = await selectCell(ui, "1:1");
    const edit = cell.querySelector('button[aria-label="2行 title を編集"]');
    assert.ok(edit);
    const navigation = new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    await React.act(async () => { edit.click(); cell.dispatchEvent(navigation); });
    assert.equal(navigation.defaultPrevented, false);
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    const input = cell.querySelector("input");
    assert.ok(input);
    assert.ok(document.activeElement === input, "new live draft owns focus");
    assert.equal(input.value, "Beta");
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: descendant controls retain navigation keys and their draft focus", async () => {
  const ui = await mount({ data: rangeData, allowMutations: true });
  try {
    const cell = await selectCell(ui, "1:1");
    const edit = cell.querySelector("button");
    edit.focus();
    for (const [key, options] of [["Home", { ctrlKey: true }], ["End", { metaKey: true }], ["PageDown", {}]]) {
      assert.equal((await press(edit, key, options)).defaultPrevented, false);
      assert.deepEqual(selectedCells(ui), ["1:1"]);
      assert.ok(document.activeElement === edit, "child button keeps its focus");
    }
    await clickButton(ui, "2行 title を編集");
    const input = cell.querySelector("input");
    assert.ok(input);
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
      assert.equal((await press(input, key, { ctrlKey: true, shiftKey: true, altKey: true })).defaultPrevented, false, key);
      assert.ok(cell.querySelector("input") === input, "same draft node retained");
      assert.ok(document.activeElement === input, "input owns navigation");
      assert.equal(input.value, "Beta");
      assert.deepEqual(selectedCells(ui), ["1:1"]);
    }
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: excluded text and other keys retain the previous nonediting behavior", async () => {
  // This checks only the existing uncancelled grid event boundary for excluded keys.
  const ui = await mount({ data: rangeData });
  const scrolls = watchNavigationScroll(ui);
  try {
    await selectCell(ui, "1:1");
    scrolls.length = 0;
    for (const key of ["Escape", "x", "Homebrew"]) {
      assert.equal((await press(document.activeElement, key)).defaultPrevented, false, key);
      assertNavigation(ui, "1:1");
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    }
    assert.deepEqual(scrolls, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: ordinary pending save and refresh permit navigation without another operation", async () => {
  const requests = [];
  let releaseRefresh;
  let refreshes = 0;
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => { refreshes++; return new Promise(resolve => { releaseRefresh = resolve; }); },
  });
  try {
    const cell = await beginTitleSave(ui, "Changed");
    assert.equal(requests.length, 1);
    assert.equal((await press(cell, "End", { altKey: true })).defaultPrevented, true);
    assertNavigation(ui, "1:2");
    await React.act(async () => requests[0].resolve(successfulWrite()));
    assert.equal(refreshes, 1);
    const receipt = ui.host.querySelector('[role="status"]');
    assert.ok(receipt);
    await press(document.activeElement, "Home");
    assertNavigation(ui, "1:0");
    await press(document.activeElement, "PageDown");
    assertNavigation(ui, "2:0");
    assert.ok(ui.host.querySelector('[role="status"]') === receipt, "navigation retains the save receipt");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.signal.aborted, false);
    await React.act(async () => releaseRefresh());
    await flush();
    assert.equal(refreshes, 1);
    assert.equal(requests.length, 1);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: same-batch Undo locks only its current history operation", async () => {
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => { refreshes++; },
  });
  try {
    const cell = await beginTitleSave(ui, "Changed");
    await React.act(async () => requests[0].resolve(successfulWrite()));
    await flush();
    const navigation = new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    await React.act(async () => {
      cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      cell.dispatchEvent(navigation);
    });
    assert.equal(requests.length, 2);
    assert.equal(navigation.defaultPrevented, false);
    assertNavigation(ui, "1:1");
    for (const key of ["Home", "PageDown", "ArrowUp"]) {
      assert.equal((await press(document.activeElement, key)).defaultPrevented, false, key);
      assertNavigation(ui, "1:1");
    }
    await pressHeader(ui, rowHeader(0));
    assert.deepEqual(selectedCells(ui), ["0:0", "0:1", "0:2"]);
    assert.equal((await press(document.activeElement, "Home")).defaultPrevented, false);
    assert.deepEqual(selectedCells(ui), ["0:0", "0:1", "0:2"]);
    assert.equal(requests[1].init.signal.aborted, false);
    await React.act(async () => requests[1].resolve(successfulWrite()));
    await flush();
    assert.equal((await press(document.activeElement, "Home")).defaultPrevented, true);
    assertNavigation(ui, "0:0");
    assert.equal(refreshes, 2);
    assert.equal(requests.length, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: obsolete history completion cannot unlock a newer transport", async () => {
  // Keep both controller lifetimes together so a stale completion cannot clear the new navigation fence.
  const oldRequests = [];
  const newRequests = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => oldRequests.push({ init, resolve })),
  });
  try {
    const oldCell = await beginTitleSave(ui, "Old");
    await React.act(async () => oldRequests[0].resolve(successfulWrite()));
    await flush();
    await press(oldCell, "z", { ctrlKey: true });
    await ui.render({ fetchFn: (_, init) => new Promise(resolve => newRequests.push({ init, resolve })) });
    assert.equal(oldRequests[1].init.signal.aborted, true);
    const currentCell = await beginTitleSave(ui, "New");
    await React.act(async () => newRequests[0].resolve(successfulWrite()));
    await flush();
    await press(currentCell, "z", { metaKey: true });
    await React.act(async () => oldRequests[1].resolve(successfulWrite()));
    await flush();
    assert.equal((await press(currentCell, "Home")).defaultPrevented, false);
    assertNavigation(ui, "1:1");
    assert.equal(newRequests.length, 2);
    assert.equal(newRequests[1].init.signal.aborted, false);
    await React.act(async () => newRequests[1].resolve(successfulWrite()));
    await flush();
    assert.equal((await press(currentCell, "Home")).defaultPrevented, true);
    assertNavigation(ui, "1:0");
    assert.equal(newRequests.length, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: an ordinary pending deletion does not become a history lock", async () => {
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ data: rangeData, allowMutations: true, confirmDelete: () => true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => { refreshes++; },
  });
  try {
    const cell = await selectCell(ui, "1:1");
    await clickButton(ui, "2行を削除");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.method, "DELETE");
    assert.equal((await press(cell, "PageDown")).defaultPrevented, true);
    assertNavigation(ui, "2:1");
    assert.equal(requests[0].init.signal.aborted, false);
    assert.equal(refreshes, 0);
    await React.act(async () => requests[0].resolve(successfulWrite()));
    await flush();
    assert.equal(requests.length, 1);
    assert.equal(refreshes, 1);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 navigation: context reset replaces the previous endpoint before the next jump", async () => {
  for (const change of ["page", "table", "transport", "opt-in"]) {
    const effects = [];
    const ui = await mount({ data: navigationData,
      fetchFn: async () => { effects.push("request"); throw Error("context navigation must not request"); },
      onRefresh: () => { effects.push("refresh"); },
    });
    try {
      await selectCell(ui, "12:2");
      await press(document.activeElement, "PageDown");
      assertNavigation(ui, "22:2");
      const next = change === "page" ? { data: { ...navigationData, page: 8 } }
        : change === "table" ? { data: { ...navigationData, def: { ...navigationData.def, table: "events" } } }
        : change === "opt-in" ? { allowMutations: true }
        : { fetchFn: async () => { effects.push("request"); throw Error("replacement must not request"); } };
      await ui.render(next);
      assertNavigation(ui, "0:0");
      await press(document.activeElement, "End", { ctrlKey: true });
      assertNavigation(ui, "24:4");
      assert.deepEqual(effects, []);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01 navigation: shrinking and empty pages retain the bounded Tab entry and table fallback", async () => {
  const ui = await mount({ data: navigationData });
  const shrunk = { ...navigationData, rows: navigationData.rows.slice(0, 2), columns: navigationData.columns.slice(0, 2) };
  try {
    await selectCell(ui, "24:4");
    await ui.render({ data: shrunk });
    assertNavigation(ui, "1:1");
    await press(document.activeElement, "PageUp");
    assertNavigation(ui, "0:1");
    await press(document.activeElement, "End", { ctrlKey: true });
    assertNavigation(ui, "1:1");
    await ui.render({ data: { ...shrunk, rows: [] } });
    const table = ui.host.querySelector("table");
    assert.ok(document.activeElement === table, "existing empty-grid fallback keeps focus");
    assert.equal(table.tabIndex, 0);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]').length, 0);
    assert.equal((await press(table, "PageDown")).defaultPrevented, false, "empty-table navigation remains out of scope");
    await ui.render({ data: shrunk });
    assert.deepEqual([...ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]')]
      .map(node => node.dataset.gridCell), ["0:1"]);
    await selectCell(ui, "0:1");
    assert.equal((await press(document.activeElement, "End")).defaultPrevented, true);
    assertNavigation(ui, "0:1");
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Tab navigation: modifier combinations collapse the selection and preserve the displayed row", async () => {
  const effects = [];
  const ui = await mount({ data: navigationData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("Tab must not request"); },
    onRefresh: () => { effects.push("refresh"); },
  });
  const scrolls = watchNavigationScroll(ui);
  try {
    for (const shiftKey of [false, true]) {
      for (const ctrlKey of [false, true]) {
        for (const metaKey of [false, true]) {
          for (const altKey of [false, true]) {
            await selectNavigationRange(ui, "12:0", "12:2");
            scrolls.length = 0;
            const end = shiftKey ? "12:1" : "12:3";
            const event = await press(document.activeElement, "Tab", { shiftKey, ctrlKey, metaKey, altKey });
            assert.equal(event.defaultPrevented, true);
            assertNavigation(ui, end);
            assert.deepEqual(scrolls, [{ position: end, options: { block: "nearest", inline: "nearest" } }]);
            assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
          }
        }
      }
    }
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Tab navigation: clamped edges consume without wrapping or scrolling", async () => {
  const ui = await mount({ data: navigationData });
  const scrolls = watchNavigationScroll(ui);
  try {
    for (const [anchor, end, shiftKey] of [["12:0", "12:4", false], ["12:4", "12:0", true]]) {
      await selectNavigationRange(ui, anchor, end);
      scrolls.length = 0;
      assert.equal((await press(document.activeElement, "Tab", { shiftKey })).defaultPrevented, true);
      assertNavigation(ui, end);
      assert.deepEqual(scrolls, []);
    }
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Tab navigation: child buttons and live drafts keep their existing event ownership", async () => {
  const effects = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("Tab must not save a draft from its TD"); },
    onRefresh: () => { effects.push("refresh"); },
  });
  try {
    const cell = await selectCell(ui, "1:1");
    const button = cell.querySelector("button");
    button.focus();
    assert.equal((await press(button, "Tab")).defaultPrevented, false);
    assert.ok(document.activeElement === button);
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    await clickButton(ui, "2行 title を編集");
    const input = cell.querySelector("input");
    assert.ok(input);
    for (const shiftKey of [false, true]) {
      assert.equal((await press(cell, "Tab", { shiftKey })).defaultPrevented, false);
      assert.ok(document.activeElement === input);
      assert.equal(input.value, "Beta");
      assert.deepEqual(selectedCells(ui), ["1:1"]);
    }
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Enter navigation: all modifiers advance the row and collapse selection without editing", async () => {
  for (const variant of [
    { mode: "editable", allowMutations: true, primaryKeys: ["id"] },
    { mode: "readonly", allowMutations: true, primaryKeys: ["id"] },
    { mode: "editable", allowMutations: false, primaryKeys: ["id"] },
    { mode: "editable", allowMutations: true, primaryKeys: [] },
  ]) {
    const effects = [];
    const ui = await mount({ data: { ...rangeData, def: { ...rangeData.def, mode: variant.mode },
      primaryKeys: variant.primaryKeys }, allowMutations: variant.allowMutations,
    fetchFn: async () => { effects.push("request"); throw Error("Enter must not request"); },
    onRefresh: () => { effects.push("refresh"); } });
    const scrolls = watchNavigationScroll(ui);
    try {
      for (let bits = 0; bits < 16; bits++) {
        const options = { ctrlKey: !!(bits & 1), metaKey: !!(bits & 2),
          altKey: !!(bits & 4), shiftKey: !!(bits & 8) };
        await selectNavigationRange(ui, "0:0", "1:1");
        scrolls.length = 0;
        assert.equal((await press(document.activeElement, "Enter", options)).defaultPrevented, true);
        assertNavigation(ui, "2:1");
        assert.deepEqual(scrolls, [{ position: "2:1", options: { block: "nearest", inline: "nearest" } }]);
        assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
      }
      await selectNavigationRange(ui, "0:0", "2:1");
      scrolls.length = 0;
      assert.equal((await press(document.activeElement, "Enter", { shiftKey: true })).defaultPrevented, true);
      assertNavigation(ui, "2:1");
      assert.deepEqual(scrolls, []);
      assert.deepEqual(effects, []);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01 Enter navigation: one row consumes and clamps without editing or scrolling", async () => {
  const ui = await mount({ data: { ...rangeData, rows: rangeData.rows.slice(0, 1) }, allowMutations: true });
  const scrolls = watchNavigationScroll(ui);
  try {
    await selectNavigationRange(ui, "0:0", "0:1");
    scrolls.length = 0;
    assert.equal((await press(document.activeElement, "Enter")).defaultPrevented, true);
    assertNavigation(ui, "0:1");
    assert.deepEqual(scrolls, []);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Enter navigation: child and same-batch/live draft retain event ownership", async () => {
  const effects = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("TD Enter must not save draft"); },
    onRefresh: () => { effects.push("refresh"); } });
  try {
    const cell = await selectCell(ui, "1:1");
    const button = cell.querySelector("button");
    button.focus();
    assert.equal((await press(button, "Enter", { ctrlKey: true })).defaultPrevented, false);
    assert.ok(document.activeElement === button);
    const following = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await React.act(async () => { button.click(); cell.dispatchEvent(following); });
    assert.equal(following.defaultPrevented, false);
    const input = cell.querySelector("input");
    assert.ok(input);
    for (let bits = 0; bits < 16; bits++) {
      assert.equal((await press(cell, "Enter", { ctrlKey: !!(bits & 1), metaKey: !!(bits & 2),
        altKey: !!(bits & 4), shiftKey: !!(bits & 8) })).defaultPrevented, false);
      assert.ok(document.activeElement === input);
      assert.equal(input.value, "Beta");
      assert.deepEqual(selectedCells(ui), ["1:1"]);
    }
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Enter navigation: ordinary pending save permits movement, matching history lock does not", async () => {
  const requests = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => {} });
  try {
    const cell = await beginTitleSave(ui, "Changed");
    assert.equal(requests.length, 1);
    assert.equal((await press(cell, "Enter")).defaultPrevented, true);
    assertNavigation(ui, "2:1");
    await React.act(async () => requests[0].resolve(successfulWrite()));
    await flush();
    await selectCell(ui, "1:1");
    const following = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await React.act(async () => {
      cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      cell.dispatchEvent(following);
    });
    assert.equal(requests.length, 2);
    assert.equal(following.defaultPrevented, false);
    assertNavigation(ui, "1:1");
    assert.equal((await press(cell, "Enter")).defaultPrevented, false);
    assertNavigation(ui, "1:1");
    await React.act(async () => requests[1].resolve(successfulWrite()));
    await flush();
    assert.equal((await press(cell, "Enter")).defaultPrevented, true);
    assertNavigation(ui, "2:1");
    assert.equal(requests.length, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 F2: all modifiers open original value and collapse the selection, without writing", async () => {
  const effects = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("F2 must not save"); },
    onRefresh: () => { effects.push("refresh"); } });
  try {
    for (let bits = 0; bits < 16; bits++) {
      await selectNavigationRange(ui, "0:0", "1:1");
      const cell = gridCell(ui, "1:1");
      assert.equal((await press(cell, "F2", { ctrlKey: !!(bits & 1), metaKey: !!(bits & 2),
        altKey: !!(bits & 4), shiftKey: !!(bits & 8) })).defaultPrevented, true);
      assert.deepEqual(selectedCells(ui), ["1:1"]);
      const editor = cell.querySelector('input[type="text"]');
      assert.ok(editor && document.activeElement === editor);
      assert.equal(editor.value, "Beta");
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 1);
      assert.equal((await press(editor, "Escape")).defaultPrevented, true);
      assertNavigation(ui, "1:1");
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    }
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 F2: denied columns and authorities still collapse selection but never open a draft", async () => {
  const variants = [
    { data: rangeData, allowMutations: false, focus: "1:1" },
    { data: { ...rangeData, def: { ...rangeData.def, mode: "readonly" } }, allowMutations: true, focus: "1:1" },
    { data: { ...rangeData, primaryKeys: [] }, allowMutations: true, focus: "1:1" },
    { data: { ...rangeData, rows: [rangeData.rows[0], { ...rangeData.rows[1], id: null }, rangeData.rows[2]] }, allowMutations: true, focus: "1:1" },
    { data: rangeData, allowMutations: true, focus: "1:0" },
    { data: rangeData, allowMutations: true, focus: "1:2" },
    { data: { ...rangeData, columns: [rangeData.columns[0], { ...rangeData.columns[1], generated: true }, rangeData.columns[2]] }, allowMutations: true, focus: "1:1" },
  ];
  for (const variant of variants) {
    const effects = [];
    const ui = await mount({ data: variant.data, allowMutations: variant.allowMutations,
      fetchFn: async () => { effects.push("request"); throw Error("F2 must not write"); },
      onRefresh: () => { effects.push("refresh"); } });
    const scrolls = watchNavigationScroll(ui);
    try {
      await selectNavigationRange(ui, "0:0", variant.focus);
      scrolls.length = 0;
      assert.equal((await press(document.activeElement, "F2")).defaultPrevented, true);
      assertNavigation(ui, variant.focus);
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
      assert.deepEqual(scrolls, []);
      assert.deepEqual(effects, []);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01 F2: child, repeated same-batch and invalidated drafts retain event ownership", async () => {
  const effects = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("F2 must not save"); },
    onRefresh: () => { effects.push("refresh"); } });
  try {
    const cell = await selectCell(ui, "1:1");
    const child = cell.querySelector("button");
    child.focus();
    assert.equal((await press(child, "F2")).defaultPrevented, false);
    assert.ok(document.activeElement === child);
    const first = new dom.window.KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    const second = new dom.window.KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    await React.act(async () => { cell.dispatchEvent(first); gridCell(ui, "2:1").dispatchEvent(second); });
    assert.equal(first.defaultPrevented, true);
    assert.equal(second.defaultPrevented, false);
    const editor = cell.querySelector("input");
    assert.ok(editor && document.activeElement === editor);
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(editor, "Unsaved");
      editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    for (const target of [editor, cell, gridCell(ui, "2:1")]) {
      assert.equal((await press(target, "F2")).defaultPrevented, false);
      assert.ok(document.activeElement === editor);
      assert.equal(editor.value, "Unsaved");
      assert.deepEqual(selectedCells(ui), ["1:1"]);
    }
    await ui.render({ data: { ...rangeData, rows: [rangeData.rows[0], { ...rangeData.rows[1], title: "Server change" }, rangeData.rows[2]] } });
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    assert.equal((await press(gridCell(ui, "2:1"), "F2")).defaultPrevented, false);
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 F2: pending ordinary write cannot open a second editor and history blocks the shortcut", async () => {
  const requests = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => {} });
  try {
    await beginTitleSave(ui, "Changed");
    assert.equal(requests.length, 1);
    await selectNavigationRange(ui, "0:0", "2:1");
    assert.equal((await press(document.activeElement, "F2")).defaultPrevented, true);
    assertNavigation(ui, "2:1");
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    await React.act(async () => requests[0].resolve(successfulWrite()));
    await flush();
    const cell = await selectCell(ui, "1:1");
    const following = new dom.window.KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    await React.act(async () => {
      cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      cell.dispatchEvent(following);
    });
    assert.equal(requests.length, 2);
    assert.equal(following.defaultPrevented, false);
    assert.equal((await press(cell, "F2")).defaultPrevented, false);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    await React.act(async () => requests[1].resolve(successfulWrite()));
    await flush();
    assert.equal((await press(cell, "F2")).defaultPrevented, true);
    assert.ok(cell.querySelector("input"));
    assert.equal(requests.length, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 F2: mixed keyboard and edit-button entry cannot retarget a live draft", async () => {
  const requests = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async (_, init) => { requests.push(init); return successfulWrite(); },
    onRefresh: () => {} });
  try {
    const firstCell = await selectCell(ui, "1:1");
    const secondCell = gridCell(ui, "2:1");
    const secondButton = secondCell.querySelector("button");
    assert.ok(secondButton && !secondButton.disabled);
    const f2 = new dom.window.KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    await React.act(async () => { firstCell.dispatchEvent(f2); secondButton.click(); });
    assert.equal(f2.defaultPrevented, true);
    const editor = firstCell.querySelector("input");
    assert.ok(editor && document.activeElement === editor);
    assert.equal(editor.value, "Beta");
    assert.deepEqual(selectedCells(ui), ["1:1"]);
    assert.equal(secondCell.querySelector("input"), null);
    assert.equal(secondCell.querySelector("button").disabled, true);
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(editor, "Kept draft");
      editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      secondCell.querySelector("button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    assert.equal(editor.value, "Kept draft");
    assert.ok(document.activeElement === editor);
    assert.equal(secondCell.querySelector("input"), null);
    assert.equal(requests.length, 0);
    await clickButton(ui, "セルを保存");
    await flush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "PATCH");
    assert.deepEqual(JSON.parse(requests[0].body).primaryKey, { id: "b2" });
    assert.equal(JSON.parse(requests[0].body).value, "Kept draft");
    await selectCell(ui, "2:1");
    await openCellEditor(secondCell);
    assert.equal(secondCell.querySelector("input").value, "Gamma");
    assert.equal(requests.length, 1);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 direct typing: delivered printable keys replace only the initial draft and preserve range collapse", async () => {
  const effects = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("typing must not save"); },
    onRefresh: () => { effects.push("refresh"); } });
  try {
    for (const [key, options] of [["a", {}], ["A", { shiftKey: true }], ["7", {}],
      ["!", { shiftKey: true }], [" ", {}], ["あ", {}], ["é", {}]]) {
      await selectNavigationRange(ui, "0:0", "1:1");
      const cell = gridCell(ui, "1:1");
      assert.equal((await press(cell, key, options)).defaultPrevented, true, key);
      const input = cell.querySelector('input[type="text"]');
      assert.ok(input && document.activeElement === input);
      assert.equal(input.value, key);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [0, key.length]);
      input.setSelectionRange(key.length, key.length);
      await ui.render();
      assert.ok(document.activeElement === input);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [key.length, key.length],
        "rerender must not select the character again");
      assert.deepEqual(selectedCells(ui), ["1:1"]);
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 1);
      assert.equal((await press(input, "Escape")).defaultPrevented, true);
      assertNavigation(ui, "1:1");
      assert.equal(cell.querySelector("input"), null);
      assert.equal(cell.querySelector("[data-grid-cell-content]").textContent, "Beta");
    }
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 direct typing: denied columns, opt-in, PK and nonprintable or modified keys leave the selection intact", async () => {
  const variants = [
    { data: rangeData, allowMutations: false, focus: "1:1" },
    { data: { ...rangeData, def: { ...rangeData.def, mode: "readonly" } }, allowMutations: true, focus: "1:1" },
    { data: { ...rangeData, primaryKeys: [] }, allowMutations: true, focus: "1:1" },
    { data: { ...rangeData, rows: [rangeData.rows[0], { ...rangeData.rows[1], id: null }, rangeData.rows[2]] }, allowMutations: true, focus: "1:1" },
    { data: rangeData, allowMutations: true, focus: "1:0" },
    { data: rangeData, allowMutations: true, focus: "1:2" },
    { data: { ...rangeData, columns: [rangeData.columns[0], { ...rangeData.columns[1], generated: true }, rangeData.columns[2]] }, allowMutations: true, focus: "1:1" },
  ];
  for (const variant of variants) {
    const ui = await mount({ data: variant.data, allowMutations: variant.allowMutations });
    try {
      await selectNavigationRange(ui, "0:0", variant.focus);
      const selection = selectedCells(ui);
      assert.equal((await press(gridCell(ui, variant.focus), "a")).defaultPrevented, false);
      assertNavigation(ui, variant.focus, selection);
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    } finally { await ui.cleanup(); }
  }
  const ui = await mount({ data: rangeData, allowMutations: true });
  try {
    await selectNavigationRange(ui, "0:0", "1:1");
    const selection = selectedCells(ui);
    for (const [key, options] of [["q", { ctrlKey: true }], ["q", { metaKey: true }],
      ["q", { altKey: true }], ["😀", {}], ["Process", {}], ["Dead", {}], ["Escape", {}]]) {
      assert.equal((await press(gridCell(ui, "1:1"), key, options)).defaultPrevented, false, key);
      assertNavigation(ui, "1:1", selection);
      assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    }
    assert.equal((await press(gridCell(ui, "1:1"), " ", { shiftKey: true })).defaultPrevented, true);
    assert.deepEqual(selectedCells(ui), rowCells);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 direct typing: same-batch mixed entry retains original PK/value and undo restores it", async () => {
  const requests = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async (_, init) => { requests.push(init); return successfulWrite(); },
    onRefresh: () => {} });
  try {
    const firstCell = await selectCell(ui, "1:1");
    const secondCell = gridCell(ui, "2:1");
    const button = secondCell.querySelector("button");
    assert.equal((await press(firstCell.querySelector("button"), "q")).defaultPrevented, false);
    const first = new dom.window.KeyboardEvent("keydown", { key: "X", shiftKey: true, bubbles: true, cancelable: true });
    const second = new dom.window.KeyboardEvent("keydown", { key: "Y", shiftKey: true, bubbles: true, cancelable: true });
    await React.act(async () => { firstCell.dispatchEvent(first); secondCell.dispatchEvent(second); button.click(); });
    assert.equal(first.defaultPrevented, true);
    assert.equal(second.defaultPrevented, false);
    const input = firstCell.querySelector("input");
    assert.ok(input && document.activeElement === input);
    assert.equal(input.value, "X");
    assert.equal(secondCell.querySelector("input"), null);
    assert.equal((await press(input, "z")).defaultPrevented, false);
    assert.equal(requests.length, 0);
    await clickButton(ui, "セルを保存");
    await flush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "PATCH");
    assert.deepEqual(JSON.parse(requests[0].body).primaryKey, { id: "b2" });
    assert.equal(JSON.parse(requests[0].body).value, "X");
    await selectCell(ui, "1:1");
    assert.equal((await press(firstCell, "z", { ctrlKey: true })).defaultPrevented, true);
    await flush();
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].body).primaryKey, { id: "b2" });
    assert.equal(JSON.parse(requests[1].body).value, "Beta");
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 direct typing: a pending ordinary write or invalidated draft cannot start another edit", async () => {
  const requests = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => {} });
  try {
    await beginTitleSave(ui, "Changed");
    assert.equal(requests.length, 1);
    await selectNavigationRange(ui, "0:0", "2:1");
    const selection = selectedCells(ui);
    assert.equal((await press(gridCell(ui, "2:1"), "q")).defaultPrevented, false);
    assertNavigation(ui, "2:1", selection);
    await React.act(async () => requests[0].resolve(successfulWrite()));
    await flush();
    const first = await selectCell(ui, "1:1");
    assert.equal((await press(first, "q")).defaultPrevented, true);
    await ui.render({ data: { ...rangeData, rows: [rangeData.rows[0], { ...rangeData.rows[1], title: "Server change" }, rangeData.rows[2]] } });
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    assert.equal((await press(gridCell(ui, "2:1"), "r")).defaultPrevented, false);
    assert.equal(ui.host.querySelectorAll('[data-grid-cell] input[type="text"]').length, 0);
    assert.equal(requests.length, 1);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 direct typing: a new draft on the same cell selects once, including batched cancel/reopen", async () => {
  const effects = [];
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: async () => { effects.push("request"); throw Error("typing must not write"); },
    onRefresh: () => { effects.push("refresh"); } });
  try {
    const cell = await selectCell(ui, "1:1");
    assert.equal((await press(cell, "x")).defaultPrevented, true);
    const first = cell.querySelector("input");
    assert.ok(first && document.activeElement === first);
    assert.deepEqual([first.selectionStart, first.selectionEnd], [0, 1]);
    first.setSelectionRange(1, 1);
    const cancel = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const reopen = new dom.window.KeyboardEvent("keydown", { key: "あ", bubbles: true, cancelable: true });
    await React.act(async () => { first.dispatchEvent(cancel); cell.dispatchEvent(reopen); });
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(reopen.defaultPrevented, true);
    const second = cell.querySelector("input");
    assert.ok(second && document.activeElement === second);
    assert.equal(second.value, "あ");
    assert.deepEqual([second.selectionStart, second.selectionEnd], [0, 1]);
    second.setSelectionRange(1, 1);
    await ui.render();
    assert.deepEqual([second.selectionStart, second.selectionEnd], [1, 1]);
    await press(second, "Escape");
    assertNavigation(ui, "1:1");
    await press(cell, "F2");
    const f2 = cell.querySelector("input");
    assert.ok(f2 && document.activeElement === f2);
    assert.equal(f2.value, "Beta");
    await press(f2, "Escape");
    await openCellEditor(cell);
    assert.equal(cell.querySelector("input").value, "Beta");
    assert.deepEqual(effects, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 TD history shortcuts: lowercase undo, y and both shifted z spellings replay committed entries only", async () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) for (const [redoKey, shiftKey] of [["y", false], ["z", true], ["Z", true]]) {
    const pending = [];
    let refreshes = 0;
    const ui = await mount({ data: rangeData, allowMutations: true,
      fetchFn: (_, init) => new Promise(resolve => pending.push({ init, resolve })),
      onRefresh: () => { refreshes++; },
    });
    try {
      const td = await selectCell(ui, "1:1");
      assert.equal((await press(td, "z", modifier)).defaultPrevented, true);
      assert.equal(pending.length, 0);
      await beginTitleSave(ui, "Changed");
      await React.act(async () => pending[0].resolve(successfulWrite()));
      assert.equal(pending.length, 1);
      assert.equal((await press(td, "Z", modifier)).defaultPrevented, false);
      assert.equal((await press(td, "Y", modifier)).defaultPrevented, false);
      assert.equal(pending.length, 1);
      assert.equal((await press(td, "z", { ...modifier, altKey: true })).defaultPrevented, true);
      assert.equal(pending.length, 2);
      assert.equal((await press(td, redoKey, { ...modifier, shiftKey })).defaultPrevented, false);
      assert.equal(pending.length, 2);
      await React.act(async () => pending[1].resolve(successfulWrite()));
      assert.equal((await press(td, redoKey, { ...modifier, shiftKey, altKey: true })).defaultPrevented, true);
      assert.equal(pending.length, 3);
      await React.act(async () => pending[2].resolve(successfulWrite()));
      assert.deepEqual(pending.map(({ init }) => [init.method, JSON.parse(init.body)]), [
        ["PATCH", { table: "videos", primaryKey: { id: "b2" }, column: "title", value: "Changed" }],
        ["PATCH", { table: "videos", primaryKey: { id: "b2" }, column: "title", value: "Beta" }],
        ["PATCH", { table: "videos", primaryKey: { id: "b2" }, column: "title", value: "Changed" }],
      ]);
      assert.equal(refreshes, 3);
      assert.equal(td.querySelector("input"), null);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01 TD clipboard shortcuts: delivered lowercase c accepts Alt and leaves uppercase C untouched", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [], writes = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { copied.push(value); } } });
  try {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const ui = await mount({ data: rangeData, fetchFn: async (_, init) => { writes.push(init); return successfulWrite(); } });
      try {
        copied.length = 0;
        const td = await selectCell(ui, "1:1");
        for (const altKey of [false, true]) {
          assert.equal((await press(td, "C", { ...modifier, altKey, shiftKey: true })).defaultPrevented, false);
          assert.equal((await press(td, "c", { ...modifier, altKey })).defaultPrevented, true);
        }
        assert.deepEqual(copied, ["Beta", "Beta"]);
        for (const [key, shiftKey] of [["z", false], ["y", false], ["Z", true]]) {
          assert.equal((await press(td, key, { ...modifier, shiftKey })).defaultPrevented, true);
        }
        assert.deepEqual(writes, []);
        assert.equal(td.querySelector("input"), null);
      } finally { await ui.cleanup(); }
    }
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

test("MIG-0737 U01 TD clipboard and history shortcuts: draft, child ownership and pending history fence; ordinary save permits copy only", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [], pending = [];
  let refreshes = 0;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { copied.push(value); } } });
  const ui = await mount({ data: rangeData, allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => pending.push({ init, resolve })), onRefresh: () => { refreshes++; },
  });
  const shortcuts = [["c", false], ["z", false], ["y", false], ["Z", true]];
  try {
    const td = await selectCell(ui, "1:1");
    const child = td.querySelector("button");
    for (const [key, shiftKey] of shortcuts) {
      assert.equal((await press(child, key, { ctrlKey: true, shiftKey })).defaultPrevented, false);
    }
    const edit = new dom.window.KeyboardEvent("keydown", { key: "Q", bubbles: true, cancelable: true });
    const staleCopy = new dom.window.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    await React.act(async () => { td.dispatchEvent(edit); td.dispatchEvent(staleCopy); });
    assert.equal(edit.defaultPrevented, true);
    assert.equal(staleCopy.defaultPrevented, false);
    const input = td.querySelector("input");
    assert.equal(input.value, "Q");
    for (const [key, shiftKey] of shortcuts) {
      assert.equal((await press(td, key, { ctrlKey: true, shiftKey })).defaultPrevented, false);
    }
    assert.equal((await press(input, "z", { ctrlKey: true })).defaultPrevented, false);
    assert.equal(input.value, "Q");
    assert.deepEqual(copied, []);
    assert.equal(pending.length, 0);
    await clickButton(ui, "セルを保存");
    assert.equal(pending.length, 1);
    for (const [key, shiftKey] of shortcuts) {
      assert.equal((await press(td, key, { ctrlKey: true, shiftKey })).defaultPrevented, true);
    }
    assert.deepEqual(copied, ["Beta"]);
    assert.equal(pending.length, 1);
    await React.act(async () => pending[0].resolve(successfulWrite()));
    const undo = new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    const lateCopy = new dom.window.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    await React.act(async () => { td.dispatchEvent(undo); td.dispatchEvent(lateCopy); });
    assert.equal(undo.defaultPrevented, true);
    assert.equal(lateCopy.defaultPrevented, false);
    assert.equal(pending.length, 2);
    for (const [key, shiftKey] of shortcuts) {
      assert.equal((await press(td, key, { metaKey: true, shiftKey })).defaultPrevented, false);
    }
    assert.deepEqual(copied, ["Beta"]);
    assert.equal(pending.length, 2);
    await React.act(async () => pending[1].resolve(successfulWrite()));
    assert.equal(refreshes, 2);
    assert.deepEqual(pending.map(({ init }) => JSON.parse(init.body).value), ["Q", "Beta"]);
    assert.equal((await press(td, "c", { metaKey: true })).defaultPrevented, true);
    assert.deepEqual(copied, ["Beta", "Beta"]);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

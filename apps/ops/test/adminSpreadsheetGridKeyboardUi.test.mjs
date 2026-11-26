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
    assert.equal(ui.host.querySelectorAll("input").length, 0);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

test("MIG-0737 U01: Enter opens only mutable columns; missing clipboard permission is reported", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async () => { throw Error("permission denied"); },
  } });
  const ui = await mount({ allowMutations: true });
  try {
    const pk = ui.host.querySelector('[data-grid-cell="0:0"]');
    await press(pk, "Enter");
    assert.equal(ui.host.querySelectorAll('button[aria-label="1行 id を編集"]').length, 0);
    assert.equal(ui.host.querySelectorAll("input").length, 0);
    const title = ui.host.querySelector('[data-grid-cell="0:1"]');
    await press(title, "Enter");
    assert.equal(ui.host.querySelectorAll('input[type="text"]').length, 1);
    await press(title, "c", { ctrlKey: true });
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
async function beginTitleSave(ui, value) {
  const cell = await selectCell(ui, "1:1");
  await press(cell, "Enter");
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
      assert.equal(ui.host.querySelectorAll("input").length, 0);
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
    await press(cell, "Enter");
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
    await press(cell, "Enter");
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
    await press(cell, "Enter");
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

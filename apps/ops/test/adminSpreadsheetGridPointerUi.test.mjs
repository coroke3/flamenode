import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { JSDOM } from "jsdom";
import { AdminSpreadsheetEditableGrid } from "../.test-dist/apps/ops/src/routes/admin/AdminSpreadsheetEditableGrid.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/spreadsheet",
});
for (const name of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const data = {
  def: { table: "videos", label: "動画", group: "content", mode: "editable" },
  columns: [
    { name: "id", type: "TEXT", editable: false, pk: 1, notNull: true },
    { name: "title", type: "TEXT", editable: true, pk: 0, notNull: false },
    { name: "note", type: "TEXT", editable: false, pk: 0, notNull: false },
  ],
  primaryKeys: ["id"],
  rows: [{ id: "a", title: "Alpha", note: "one" }, { id: "b", title: "Beta", note: "two" },
    { id: "c", title: "Gamma", note: "" }],
  page: 2, limit: 3, hasMore: false,
};
const allCells = ["0:0", "0:1", "0:2", "1:0", "1:1", "1:2", "2:0", "2:1", "2:2"];
async function mount(props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const calls = [];
  let refreshes = 0;
  let current = { data, fetchFn: async (...args) => { calls.push(args); throw Error("unexpected request"); },
    onRefresh: () => { refreshes++; }, ...props };
  const render = async next => {
    current = { ...current, ...next };
    await React.act(async () => root.render(React.createElement(AdminSpreadsheetEditableGrid, current)));
  };
  await render();
  return { host, render, calls, get refreshes() { return refreshes; }, cleanup: async () => {
    await React.act(async () => root.unmount()); host.remove();
  } };
}
function cell(ui, position) {
  const node = ui.host.querySelector(`[data-grid-cell="${position}"]`);
  assert.ok(node, "missing cell " + position);
  return node;
}
function selected(ui) {
  return [...ui.host.querySelectorAll('[data-grid-cell][aria-selected="true"]')].map(node => node.dataset.gridCell);
}
function resizer(ui, index = 1) {
  const node = ui.host.querySelector(`[data-grid-column-header="${index}"] [data-grid-column-resizer]`);
  assert.ok(node);
  return node;
}
function mouse(type, options = {}) {
  return new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...options });
}
async function down(node, options = {}) {
  const event = mouse("mousedown", { buttons: 1, clientX: 100, detail: 1, ...options });
  await React.act(async () => node.dispatchEvent(event));
  return event;
}
function transition(from, to, options = {}) {
  from.dispatchEvent(mouse("mouseout", { relatedTarget: to, ...options }));
  to.dispatchEvent(mouse("mouseover", { relatedTarget: from, ...options }));
}
async function enter(from, to, options = {}) {
  await React.act(async () => transition(from, to, options));
}
async function up(node = window, options = {}) {
  await React.act(async () => node.dispatchEvent(mouse("mouseup", options)));
}
async function terminalClick(node, options = {}) {
  await React.act(async () => node.dispatchEvent(mouse("click", { detail: 1, ...options })));
}
async function select(ui, position, options = {}) {
  const node = cell(ui, position);
  await down(node, options);
  await up(node);
  await terminalClick(node, options);
  return node;
}
async function key(node, value, options = {}) {
  const event = new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
  await React.act(async () => node.dispatchEvent(event));
  return event;
}
function button(ui, name) {
  const node = [...ui.host.querySelectorAll("button")].find(node =>
    node.getAttribute("aria-label") === name || node.textContent === name);
  assert.ok(node, "missing button " + name);
  return node;
}
async function setInput(node, value) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function editTitle(ui) {
  await React.act(async () => button(ui, "1行 title を編集").click());
  const input = cell(ui, "0:1").querySelector("input");
  assert.ok(input);
  await setInput(input, "Unsaved");
  return input;
}
function assertNoEffects(ui) {
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.refreshes, 0);
}

for (const [name, position, wrapped] of [["TD", "1:1", false], ["value", "0:1", true], ["empty value", "2:2", true]]) {
  test(`MIG-0737 U01 pointer: primary ${name} press selects before click and owns the endpoint focus`, async () => {
    const ui = await mount();
    try {
      const node = cell(ui, position);
      const target = wrapped ? node.querySelector("[data-grid-cell-content]") : node;
      assert.equal((await down(target)).defaultPrevented, true);
      assert.deepEqual(selected(ui), [position]);
      assert.ok(document.activeElement === node, "expected pointer focus owner");
      assert.deepEqual([...ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]')].map(cell => cell.dataset.gridCell), [position]);
      await up(target);
      await terminalClick(target);
      assert.deepEqual(selected(ui), [position]);
      assertNoEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

for (const scenario of [
  { name: "forward Shift", start: "0:0", end: "2:2", options: { shiftKey: true }, expected: allCells },
  { name: "reverse Shift with other modifiers", start: "2:2", end: "0:1",
    options: { shiftKey: true, ctrlKey: true, metaKey: true, altKey: true },
    expected: ["0:1", "0:2", "1:1", "1:2", "2:1", "2:2"] },
  { name: "Ctrl Meta Alt ordinary press", start: "0:0", end: "2:2",
    options: { ctrlKey: true, metaKey: true, altKey: true }, expected: ["2:2"] },
]) {
  test(`MIG-0737 U01 pointer: ${scenario.name} retains CURRENT anchor rules through physical click`, async () => {
    const ui = await mount();
    try {
      await select(ui, scenario.start);
      await select(ui, scenario.end, scenario.options);
      assert.deepEqual(selected(ui), scenario.expected);
      assert.ok(document.activeElement === cell(ui, scenario.end), "expected pointer focus owner");
      assertNoEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

for (const buttonNumber of [1, 2]) {
  test(`MIG-0737 U01 pointer: data button ${buttonNumber} neither selects nor starts a drag`, async () => {
    const ui = await mount();
    try {
      await select(ui, "1:1");
      assert.equal((await down(cell(ui, "0:0"), { button: buttonNumber })).defaultPrevented, false);
      await enter(cell(ui, "0:0"), cell(ui, "2:2"), { buttons: 1 });
      assert.deepEqual(selected(ui), ["1:1"]);
      assert.ok(document.activeElement === cell(ui, "1:1"), "expected pointer focus owner");
      await up(window, { button: buttonNumber });
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 pointer: rectangle, TSV and following arrow use the dragged endpoint", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => copied.push(text) } });
  const ui = await mount();
  const scrolls = [];
  for (const node of ui.host.querySelectorAll("[data-grid-cell]")) {
    node.scrollIntoView = options => scrolls.push({ position: node.dataset.gridCell, options });
  }
  try {
    await down(cell(ui, "1:1"));
    await enter(cell(ui, "1:1"), cell(ui, "2:2"), { buttons: 0 });
    const rectangle = ["1:1", "1:2", "2:1", "2:2"];
    assert.deepEqual(selected(ui), rectangle);
    assert.ok(document.activeElement === cell(ui, "2:2"), "expected pointer focus owner");
    assert.equal(cell(ui, "2:2").tabIndex, 0);
    assert.equal(cell(ui, "1:1").tabIndex, -1);
    assert.deepEqual(scrolls.at(-1), { position: "2:2", options: { block: "nearest", inline: "nearest" } });
    assert.deepEqual(copied, []);
    await up(cell(ui, "2:2"));
    await terminalClick(cell(ui, "2:2"));
    assert.deepEqual(selected(ui), rectangle);
    await key(document.activeElement, "c", { ctrlKey: true });
    assert.deepEqual(copied, ["Beta\ttwo\nGamma\t"]);
    await key(document.activeElement, "ArrowUp");
    assert.deepEqual(selected(ui), ["1:2"]);
    assert.ok(document.activeElement === cell(ui, "1:2"), "expected pointer focus owner");
    assertNoEffects(ui);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

test("MIG-0737 U01 pointer: hover and header selection alone do not start data dragging", async () => {
  const ui = await mount();
  try {
    await enter(document.body, cell(ui, "2:2"), { buttons: 1 });
    assert.deepEqual(selected(ui), ["0:0"]);
    for (const selector of ["[data-grid-all-header]", '[data-grid-column-header="1"]', '[data-grid-row-header="1"]']) {
      const head = ui.host.querySelector(selector);
      await down(head);
      const range = selected(ui);
      await enter(head, cell(ui, "0:0"));
      assert.deepEqual(selected(ui), range);
      await up();
    }
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

for (const release of ["cell", "outside"]) {
  test(`MIG-0737 U01 pointer: ${release} mouseup of any button ends the shared gesture`, async () => {
    const ui = await mount();
    try {
      await down(cell(ui, "0:0"));
      await enter(cell(ui, "0:0"), cell(ui, "2:2"));
      assert.deepEqual(selected(ui), allCells);
      await up(release === "cell" ? cell(ui, "2:2") : window, { button: 2 });
      await enter(cell(ui, "2:2"), cell(ui, "0:1"));
      assert.deepEqual(selected(ui), allCells);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 pointer: window blur retains CURRENT dragging until mouseup", async () => {
  const ui = await mount();
  try {
    await down(cell(ui, "0:0"));
    await React.act(async () => window.dispatchEvent(new dom.window.Event("blur")));
    await enter(cell(ui, "0:0"), cell(ui, "2:2"));
    assert.deepEqual(selected(ui), allCells);
    await up();
  } finally { await ui.cleanup(); }
});

for (const [name, replacement] of [
  ["page", { data: { ...data, page: 3 } }],
  ["table", { data: { ...data, def: { ...data.def, table: "songs" } } }],
  ["transport", null],
  ["opt-in", { allowMutations: true }],
]) {
  test(`MIG-0737 U01 pointer: mounted ${name} replacement resets the range but retains dragging`, async () => {
    const ui = await mount();
    const replacementRequests = [];
    try {
      await down(cell(ui, "1:1"));
      await ui.render(replacement ?? { fetchFn: async (...args) => {
        replacementRequests.push(args);
        throw Error("unexpected replacement request");
      } });
      assert.deepEqual(selected(ui), ["0:0"]);
      await enter(document.body, cell(ui, "1:2"));
      assert.deepEqual(selected(ui), ["0:0", "0:1", "0:2", "1:0", "1:1", "1:2"]);
      assert.ok(document.activeElement === cell(ui, "1:2"), "expected pointer focus owner");
      await up();
      assertNoEffects(ui);
      assert.equal(replacementRequests.length, 0);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 pointer: dimension shrink and empty recovery clamp the current gesture", async () => {
  const ui = await mount();
  try {
    await down(cell(ui, "2:2"));
    await enter(cell(ui, "2:2"), cell(ui, "0:0"));
    const smaller = { ...data, rows: data.rows.slice(0, 2), columns: data.columns.slice(0, 2) };
    await ui.render({ data: smaller });
    await enter(document.body, cell(ui, "1:0"));
    assert.deepEqual(selected(ui), ["1:0", "1:1"]);
    await ui.render({ data: { ...data, rows: [], columns: [] } });
    assert.deepEqual(selected(ui), []);
    assert.ok(document.activeElement === ui.host.querySelector("table"), "expected pointer focus owner");
    await ui.render({ data });
    await enter(document.body, cell(ui, "2:2"));
    assert.deepEqual(selected(ui), allCells);
    assert.ok(document.activeElement === cell(ui, "2:2"), "expected pointer focus owner");
    await up();
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: resize and range share dragging and the same mouseup", async () => {
  const ui = await mount();
  try {
    await select(ui, "1:1");
    const handle = resizer(ui);
    assert.equal((await down(handle, { button: 2, shiftKey: true })).defaultPrevented, true);
    assert.deepEqual(selected(ui), ["1:1"]);
    await enter(handle, cell(ui, "2:2"));
    assert.deepEqual(selected(ui), ["1:1", "1:2", "2:1", "2:2"]);
    assert.ok(document.activeElement === cell(ui, "2:2"), "expected pointer focus owner");
    await React.act(async () => window.dispatchEvent(mouse("mousemove", { clientX: 180 })));
    assert.equal(ui.host.querySelector('[data-grid-column-header="1"]').style.width, "190px");
    await up();
    await enter(cell(ui, "2:2"), cell(ui, "0:0"));
    await React.act(async () => window.dispatchEvent(mouse("mousemove", { clientX: 1000 })));
    assert.deepEqual(selected(ui), ["1:1", "1:2", "2:1", "2:2"]);
    assert.equal(ui.host.querySelector('[data-grid-column-header="1"]').style.width, "190px");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

for (const owner of ["external", "Find", "toolbar", "child button", "other grid"]) {
  test(`MIG-0737 U01 pointer: resize-origin entry preserves ${owner} focus`, async () => {
    const ui = await mount({ allowMutations: true });
    const outside = document.createElement("input");
    document.body.append(outside);
    let other;
    try {
      await select(ui, "1:1");
      let active = outside;
      if (owner === "Find") {
        await key(cell(ui, "1:1"), "f", { ctrlKey: true });
        active = ui.host.querySelector('input[type="search"]');
        await setInput(active, "Alpha");
      } else if (owner === "toolbar") active = button(ui, "行を追加");
      else if (owner === "child button") active = button(ui, "1行 title を編集");
      else if (owner === "other grid") { other = await mount(); active = cell(other, "0:0"); }
      active.focus();
      const handle = resizer(ui);
      await down(handle);
      await enter(handle, cell(ui, "2:2"));
      assert.deepEqual(selected(ui), ["1:1", "1:2", "2:1", "2:2"]);
      assert.ok(document.activeElement === active, "expected pointer focus owner");
      if (owner === "Find") {
        assert.equal(active.value, "Alpha");
        assert.equal(cell(ui, "0:1").dataset.findMatch, "true");
      }
      await up();
      assertNoEffects(ui);
    } finally { if (other) await other.cleanup(); outside.remove(); await ui.cleanup(); }
  });
}

test("MIG-0737 U01 pointer: table-owned focus transfers to the resize-selected endpoint after empty recovery", async () => {
  const ui = await mount({ data: { ...data, rows: [] } });
  try {
    const table = ui.host.querySelector("table");
    table.focus();
    await ui.render({ data });
    assert.ok(document.activeElement === table, "expected pointer focus owner");
    const handle = resizer(ui);
    await down(handle);
    await enter(handle, cell(ui, "2:2"));
    assert.deepEqual(selected(ui), allCells);
    assert.ok(document.activeElement === cell(ui, "2:2"), "expected pointer focus owner");
    await up();
    await key(document.activeElement, "ArrowUp");
    assert.deepEqual(selected(ui), ["1:2"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: active draft keeps input, selection and focus while resize remains available", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const input = await editTitle(ui);
    assert.equal((await down(input)).defaultPrevented, false);
    assert.equal((await down(cell(ui, "1:1"))).defaultPrevented, true);
    await enter(cell(ui, "1:1"), cell(ui, "2:2"));
    const handle = resizer(ui);
    await down(handle);
    await enter(handle, cell(ui, "2:2"));
    await React.act(async () => window.dispatchEvent(mouse("mousemove", { clientX: 140 })));
    assert.equal(ui.host.querySelector('[data-grid-column-header="1"]').style.width, "150px");
    assert.deepEqual(selected(ui), ["0:1"]);
    assert.ok(document.activeElement === input, "expected pointer focus owner");
    assert.ok(cell(ui, "0:1").querySelector("input") === input, "same draft input retained");
    assert.equal(input.value, "Unsaved");
    await up();
    const cancel = button(ui, "キャンセル");
    assert.equal((await down(cancel)).defaultPrevented, false);
    await React.act(async () => cancel.click());
    assert.ok(cell(ui, "0:1").querySelector("input") === null, "draft input removed");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: same-batch edit start fences a following cell press and resize-origin enter", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    await down(resizer(ui));
    const blocked = mouse("mousedown", { buttons: 1 });
    await React.act(async () => {
      button(ui, "1行 title を編集").click();
      cell(ui, "2:2").dispatchEvent(blocked);
      transition(resizer(ui), cell(ui, "2:2"));
    });
    assert.equal(blocked.defaultPrevented, true);
    assert.deepEqual(selected(ui), ["0:1"]);
    assert.ok(document.activeElement === cell(ui, "0:1").querySelector("input"), "expected pointer focus owner");
    assertNoEffects(ui);
    await up();
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: invalidated draft still fences cell selection until explicit discard", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    await editTitle(ui);
    await ui.render({ data: { ...data, rows: [{ ...data.rows[0], title: "Server change" }, ...data.rows.slice(1)] } });
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    await down(resizer(ui));
    assert.equal((await down(cell(ui, "2:2"))).defaultPrevented, true);
    await enter(document.body, cell(ui, "2:2"));
    assert.deepEqual(selected(ui), ["0:1"]);
    await up();
    await React.act(async () => button(ui, "編集を破棄").click());
    await select(ui, "2:2");
    assert.deepEqual(selected(ui), ["2:2"]);
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: ordinary PATCH, refresh and pending history do not add a pointer lock", async () => {
  // Keep one save/refresh/replay lifetime together to prove selection never adds or aborts a request.
  const requests = [];
  let releaseRefresh;
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => { refreshes++; if (refreshes === 1) return new Promise(resolve => { releaseRefresh = resolve; }); },
  });
  const success = () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  try {
    await editTitle(ui);
    await React.act(async () => button(ui, "セルを保存").click());
    assert.equal(requests.length, 1);
    await down(cell(ui, "1:1"));
    await enter(cell(ui, "1:1"), cell(ui, "2:2"));
    assert.deepEqual(selected(ui), ["1:1", "1:2", "2:1", "2:2"]);
    await up();
    await React.act(async () => requests[0].resolve(success()));
    assert.equal(refreshes, 1);
    await select(ui, "0:0");
    await select(ui, "2:2", { shiftKey: true });
    assert.deepEqual(selected(ui), allCells);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.signal.aborted, false);
    await React.act(async () => releaseRefresh());
    await key(document.activeElement, "z", { ctrlKey: true });
    assert.equal(requests.length, 2);
    await down(cell(ui, "1:1"));
    await enter(cell(ui, "1:1"), cell(ui, "2:2"));
    await up();
    assert.deepEqual(selected(ui), ["1:1", "1:2", "2:1", "2:2"]);
    assert.equal((await key(document.activeElement, "a", { ctrlKey: true })).defaultPrevented, false);
    assert.equal(requests[1].init.signal.aborted, false);
    assert.equal(requests.length, 2);
    await React.act(async () => requests[1].resolve(success()));
    assert.equal(refreshes, 2);
    assert.equal(requests.length, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: range, readonly and Find feedback retain CURRENT precedence and endpoint inset", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    await down(cell(ui, "0:0"));
    await enter(cell(ui, "0:0"), cell(ui, "1:1"));
    await up();
    assert.equal(cell(ui, "0:1").style.background, "var(--sheet-focus-soft)");
    assert.equal(cell(ui, "0:0").style.background, "var(--sheet-header-bg)");
    assert.equal(cell(ui, "1:1").style.boxShadow, "inset 0 0 0 2px var(--sheet-focus)");
    assert.equal(cell(ui, "1:1").style.position, "relative");
    assert.equal(cell(ui, "1:1").style.zIndex, "1");
    assert.equal(cell(ui, "0:1").style.boxShadow, "");
    await key(document.activeElement, "f", { ctrlKey: true });
    await setInput(ui.host.querySelector('input[type="search"]'), "Beta");
    assert.match(cell(ui, "1:1").style.background, /#fbbc04/);
    assert.equal(cell(ui, "1:1").style.boxShadow, "inset 0 0 0 2px var(--sheet-focus)");
    const rules = [...ui.host.querySelector("style").sheet.cssRules];
    assert.equal(rules[0].selectorText, "[data-spreadsheet-grid-viewport]");
    assert.equal(rules[0].style.getPropertyValue("--sheet-focus").trim(), "#1a73e8");
    const dark = rules.find(rule => rule.conditionText === "(prefers-color-scheme: dark)");
    assert.ok(dark);
    assert.equal(dark.cssRules[0].selectorText,
      ':root:not([data-theme="light"]):not([data-theme="dark"]) [data-spreadsheet-grid-viewport]');
    assert.equal(dark.cssRules[0].style.getPropertyValue("--sheet-focus").trim(), "var(--accent-primary, #8ab4f8)");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: synthetic batched start and release retain CURRENT React-state timing", async () => {
  const ui = await mount();
  try {
    await React.act(async () => {
      cell(ui, "0:0").dispatchEvent(mouse("mousedown", { buttons: 1 }));
      transition(cell(ui, "0:0"), cell(ui, "2:2"));
    });
    assert.deepEqual(selected(ui), ["0:0"]);
    await enter(cell(ui, "0:0"), cell(ui, "2:2"));
    assert.deepEqual(selected(ui), allCells);
    await React.act(async () => {
      window.dispatchEvent(mouse("mouseup"));
      transition(cell(ui, "2:2"), cell(ui, "0:1"));
    });
    assert.deepEqual(selected(ui), ["0:0", "0:1"]);
    await enter(cell(ui, "0:1"), cell(ui, "2:2"));
    assert.deepEqual(selected(ui), ["0:0", "0:1"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 pointer: unmount removes the shared listener and a new Grid has no retained gesture", async () => {
  const originalAdd = window.addEventListener;
  const originalRemove = window.removeEventListener;
  const listeners = new Set();
  window.addEventListener = function(type, listener, options) {
    if (type === "mouseup") listeners.add(listener);
    return originalAdd.call(this, type, listener, options);
  };
  window.removeEventListener = function(type, listener, options) {
    if (type === "mouseup") listeners.delete(listener);
    return originalRemove.call(this, type, listener, options);
  };
  let ui;
  try {
    ui = await mount();
    await down(cell(ui, "0:0"));
    await enter(cell(ui, "0:0"), cell(ui, "2:2"));
    assert.equal(listeners.size, 1);
    await ui.cleanup();
    ui = null;
    assert.equal(listeners.size, 0);
    ui = await mount();
    await enter(document.body, cell(ui, "2:2"));
    assert.deepEqual(selected(ui), ["0:0"]);
  } finally {
    if (ui) await ui.cleanup();
    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
  }
});

const sheetPalettes = {
  light: {
    "--sheet-bg": "#ffffff",
    "--sheet-header-bg": "#f8f9fa",
    "--sheet-focus": "#1a73e8",
    "--sheet-focus-soft": "color-mix(in srgb, #1a73e8 10%, #ffffff)",
  },
  dark: {
    "--sheet-bg": "var(--bg-base, #1a1a1a)",
    "--sheet-header-bg": "var(--bg-elevated, #252525)",
    "--sheet-focus": "var(--accent-primary, #8ab4f8)",
    "--sheet-focus-soft": "color-mix(in srgb, var(--accent-primary, #8ab4f8) 14%, var(--bg-base, #1a1a1a))",
  },
};

// JSDOM resolves matching custom-property declarations, not media preferences, rendered colors or contrast.
test("MIG-0737 U01 theme: explicit root palettes resolve on mount and switch without remounting", async () => {
  const previous = document.documentElement.getAttribute("data-theme");
  let ui;
  try {
    for (const initial of ["light", "dark"]) {
      document.documentElement.setAttribute("data-theme", initial);
      ui = await mount();
      const viewport = ui.host.querySelector("[data-spreadsheet-grid-viewport]");
      assert.ok(viewport);
      for (const theme of [initial, initial === "light" ? "dark" : "light", initial]) {
        await React.act(async () => document.documentElement.setAttribute("data-theme", theme));
        assert.ok(ui.host.querySelector("[data-spreadsheet-grid-viewport]") === viewport, "same viewport retained");
        const computed = window.getComputedStyle(viewport);
        for (const [property, value] of Object.entries(sheetPalettes[theme])) {
          assert.equal(computed.getPropertyValue(property).trim(), value, theme + " " + property);
        }
        assertNoEffects(ui);
      }
      await ui.cleanup();
      ui = null;
    }
  } finally {
    if (ui) await ui.cleanup();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

test("MIG-0737 U01 theme: system fallback excludes recognized root themes and unrelated elements", async () => {
  const previous = document.documentElement.getAttribute("data-theme");
  const ui = await mount();
  const outside = document.createElement("div");
  document.body.append(outside);
  try {
    const viewport = ui.host.querySelector("[data-spreadsheet-grid-viewport]");
    assert.ok(viewport);
    const media = [...ui.host.querySelector("style").sheet.cssRules]
      .find(rule => rule.conditionText === "(prefers-color-scheme: dark)");
    assert.ok(media);
    const fallback = media.cssRules[0];
    for (const [theme, matches] of [[null, true], ["system", true], ["sepia", true], ["light", false], ["dark", false]]) {
      if (theme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", theme);
      assert.equal(viewport.matches(fallback.selectorText), matches, "fallback applicability for " + theme);
      assert.equal(outside.matches(fallback.selectorText), false);
    }
    for (const [property, value] of Object.entries(sheetPalettes.dark)) {
      assert.equal(fallback.style.getPropertyValue(property).trim(), value, property);
    }
    assertNoEffects(ui);
  } finally {
    outside.remove();
    await ui.cleanup();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

test("MIG-0737 U01 theme: switching preserves the selected range, Find query and active search node", async () => {
  const previous = document.documentElement.getAttribute("data-theme");
  const ui = await mount({ allowMutations: true });
  try {
    await down(cell(ui, "0:0"));
    await enter(cell(ui, "0:0"), cell(ui, "1:1"));
    await up();
    await key(document.activeElement, "f", { ctrlKey: true });
    const search = ui.host.querySelector('input[type="search"]');
    assert.ok(search);
    await setInput(search, "Beta");
    const range = selected(ui);
    for (const theme of ["dark", "light"]) {
      await React.act(async () => document.documentElement.setAttribute("data-theme", theme));
      assert.deepEqual(selected(ui), range);
      assert.ok(document.activeElement === search, "Find retains DOM focus");
      assert.ok(ui.host.querySelector('input[type="search"]') === search, "same Find input retained");
      assert.equal(search.value, "Beta");
      assert.equal(cell(ui, "1:1").dataset.findMatch, "true");
      assert.match(cell(ui, "1:1").style.background, /#fbbc04/);
      assert.equal(cell(ui, "0:0").style.background, "var(--sheet-header-bg)");
      assertNoEffects(ui);
      const computed = window.getComputedStyle(ui.host.querySelector("[data-spreadsheet-grid-viewport]"));
      for (const [property, value] of Object.entries(sheetPalettes[theme])) {
        assert.equal(computed.getPropertyValue(property).trim(), value, property);
      }
    }
  } finally {
    await ui.cleanup();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

test("MIG-0737 U01 theme: switching retains the live draft input, value, focus and explicit cancellation", async () => {
  const previous = document.documentElement.getAttribute("data-theme");
  const ui = await mount({ allowMutations: true });
  try {
    const input = await editTitle(ui);
    for (const theme of ["dark", "light", "dark"]) {
      await React.act(async () => document.documentElement.setAttribute("data-theme", theme));
      assert.ok(cell(ui, "0:1").querySelector("input") === input, "same draft input retained");
      assert.ok(document.activeElement === input, "draft retains DOM focus");
      assert.equal(input.value, "Unsaved");
      assert.deepEqual(selected(ui), ["0:1"]);
      assertNoEffects(ui);
      const computed = window.getComputedStyle(ui.host.querySelector("[data-spreadsheet-grid-viewport]"));
      for (const [property, value] of Object.entries(sheetPalettes[theme])) {
        assert.equal(computed.getPropertyValue(property).trim(), value, property);
      }
    }
    await key(input, "Escape");
    assert.ok(cell(ui, "0:1").querySelector("input") === null, "original draft remains cancellable");
    assert.ok(document.activeElement === cell(ui, "0:1"), "cancel restores cell focus");
    assertNoEffects(ui);
  } finally {
    await ui.cleanup();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

test("MIG-0737 U01 theme: two Grids retain scoped palettes through a sibling unmount", async () => {
  // Keep both mounts and the sibling removal together to verify that a shared root theme never leaks sheet variables.
  const previous = document.documentElement.getAttribute("data-theme");
  const grids = [];
  const outside = document.createElement("div");
  document.body.append(outside);
  try {
    grids.push(await mount());
    grids.push(await mount());
    await select(grids[0], "1:1");
    await select(grids[1], "2:1");
    for (const theme of ["dark", "light"]) {
      await React.act(async () => document.documentElement.setAttribute("data-theme", theme));
      for (const ui of grids) {
        const computed = window.getComputedStyle(ui.host.querySelector("[data-spreadsheet-grid-viewport]"));
        for (const [property, value] of Object.entries(sheetPalettes[theme])) {
          assert.equal(computed.getPropertyValue(property).trim(), value, property);
          assert.equal(window.getComputedStyle(outside).getPropertyValue(property), "", "no external sheet variable");
        }
        assertNoEffects(ui);
      }
      assert.deepEqual(selected(grids[0]), ["1:1"]);
      assert.deepEqual(selected(grids[1]), ["2:1"]);
    }
    await grids.shift().cleanup();
    await React.act(async () => document.documentElement.setAttribute("data-theme", "dark"));
    const computed = window.getComputedStyle(grids[0].host.querySelector("[data-spreadsheet-grid-viewport]"));
    for (const [property, value] of Object.entries(sheetPalettes.dark)) {
      assert.equal(computed.getPropertyValue(property).trim(), value, "surviving Grid " + property);
      assert.equal(window.getComputedStyle(outside).getPropertyValue(property), "", "no external sheet variable");
    }
    assert.deepEqual(selected(grids[0]), ["2:1"]);
    assert.ok(document.activeElement === cell(grids[0], "2:1"), "sibling unmount preserves remaining Grid focus");
    assertNoEffects(grids[0]);
  } finally {
    for (const ui of grids) await ui.cleanup();
    outside.remove();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

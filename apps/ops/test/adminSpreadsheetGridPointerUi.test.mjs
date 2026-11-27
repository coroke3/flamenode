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

function assertStatus(ui, expected) {
  const bars = ui.host.querySelectorAll("[data-spreadsheet-grid-status]");
  assert.equal(bars.length, 1, "one selection status bar is mounted");
  const bar = bars[0];
  assert.ok(bar.previousElementSibling === ui.host.querySelector("[data-spreadsheet-grid-viewport]"),
    "status immediately follows the viewport");
  assert.equal(bar.getAttribute("role"), null);
  assert.equal(bar.getAttribute("aria-live"), null);
  const spans = [...bar.children];
  assert.ok(spans.length > 0 && spans.every(node => node.tagName === "SPAN"), "ordinary status spans");
  const texts = [expected.summary];
  if (expected.sum != null) texts.push("合計 " + expected.sum.toLocaleString());
  if (expected.preview) texts.push(expected.preview);
  assert.deepEqual(spans.map(node => node.textContent), texts);
  assert.equal(spans[0].getAttribute("role"), null);
  if (expected.preview) assert.equal(spans.at(-1).getAttribute("title"), expected.preview);
  assert.ok(bar.querySelector("b") === null, "preview content stays text, including HTML-shaped values");
  return bar;
}

const statusColumns = [
  { name: "id", type: "TEXT", editable: false, pk: 1, notNull: true },
  { name: "value", type: "NUMERIC", editable: true, pk: 0, notNull: false },
  { name: "other", type: "TEXT", editable: false, pk: 0, notNull: false, generated: true },
];
// These fixed inputs/outputs also characterize CURRENT computeSelectionStats and its rendered StatusBar.
const statusCases = [
  { name: "single required primary-key metadata", rows: [{ id: "a", value: "first", other: "" }],
    anchor: "0:0", focus: "0:0", expected: { summary: "TEXT · 必須 · PK", preview: "a" } },
  { name: "reverse mixed rectangle with whitespace and duplicate previews", rows: [
    { id: null, value: "", other: " " }, { id: 0, value: "0", other: false },
    { id: "0x10", value: "1e2", other: "junk" }, { id: "Infinity", value: "NaN", other: { n: 2 } },
  ], anchor: "3:2", focus: "0:0", expected: { summary: "12 セル · 入力 10", sum: 116, preview: "  · 0 · 0" } },
  { name: "display-formatted JSON and escaped preview before later numeric cells", rows: [
    { id: { a: 1 }, value: [2], other: "<b> hi </b>" },
    { id: " fourth ", value: "-2.5", other: "1e3" },
  ], anchor: "0:0", focus: "1:2",
  expected: { summary: "6 セル · 入力 6", sum: 997.5, preview: '{"a":1} · [2] · <b> hi </b>' } },
  { name: "zero numeric total remains visible", columns: statusColumns.slice(0, 2),
    rows: [{ id: "-2", value: "2" }], anchor: "0:0", focus: "0:1",
    expected: { summary: "2 セル · 入力 2", sum: 0, preview: "-2 · 2" } },
  { name: "finite operands preserve accumulated overflow", columns: [statusColumns[1]],
    rows: [{ value: "1e308" }, { value: "1e308" }], anchor: "0:0", focus: "1:0",
    expected: { summary: "2 セル · 入力 2", sum: Infinity, preview: "1e308 · 1e308" } },
  { name: "null and missing cells still count", columns: statusColumns.slice(0, 2),
    rows: [{ id: null }], anchor: "0:0", focus: "0:1", expected: { summary: "2 セル · 入力 0" } },
  { name: "zero rows retains focused column metadata", rows: [], anchor: "0:0", focus: "0:0",
    expected: { summary: "TEXT · 必須 · PK" } },
  { name: "zero columns keeps an empty status span", columns: [], rows: [{}], anchor: "0:0", focus: "0:0",
    expected: { summary: "" } },
  { name: "single generated readonly boolean is not a number", columns: [statusColumns[2]],
    rows: [{ other: false }], anchor: "0:0", focus: "0:0", expected: { summary: "TEXT", preview: "false" } },
];

for (const scenario of statusCases) {
  test(`MIG-0737 U01 status: ${scenario.name}`, async () => {
    const columns = scenario.columns ?? statusColumns;
    const ui = await mount({ data: { ...data, columns, rows: scenario.rows } });
    try {
      if (scenario.rows.length && columns.length) {
        await select(ui, scenario.anchor);
        if (scenario.focus !== scenario.anchor) await select(ui, scenario.focus, { shiftKey: true });
      }
      assertStatus(ui, scenario.expected);
      assertNoEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 status: headers and keyboard ranges report the current-page cells", async () => {
  const ui = await mount();
  const row = { summary: "3 セル · 入力 3", preview: "b · Beta · two" };
  const column = { summary: "3 セル · 入力 3", preview: "Alpha · Beta · Gamma" };
  const page = { summary: "9 セル · 入力 8", preview: "a · Alpha · one" };
  try {
    for (const [selector, expected] of [
      ['[data-grid-row-header="1"]', row], ['[data-grid-column-header="1"]', column],
      ["[data-grid-all-header]", page],
    ]) {
      await down(ui.host.querySelector(selector));
      await up();
      assertStatus(ui, expected);
    }
    for (const [pressed, options, expected] of [
      ["a", { ctrlKey: true }, page], [" ", { shiftKey: true }, row],
      [" ", { ctrlKey: true }, column],
      ["ArrowDown", { shiftKey: true }, { summary: "2 セル · 入力 2", preview: "Beta · Gamma" }],
    ]) {
      await select(ui, "1:1");
      await key(document.activeElement, pressed, options);
      assertStatus(ui, expected);
    }
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 status: current rows, reordered columns and bounded dimensions replace stale summaries", async () => {
  const ui = await mount();
  const updated = { ...data, rows: [{ ...data.rows[0], title: "1200", note: "34.5" }, ...data.rows.slice(1)] };
  const reordered = { ...updated, columns: [data.columns[2], data.columns[1], data.columns[0]] };
  const shrunk = { ...reordered, rows: updated.rows.slice(0, 1), columns: reordered.columns.slice(0, 2) };
  try {
    await select(ui, "2:2");
    await select(ui, "0:1", { shiftKey: true });
    assertStatus(ui, { summary: "6 セル · 入力 5", preview: "Alpha · one · Beta" });
    const active = document.activeElement;
    await ui.render({ data: updated });
    assertStatus(ui, { summary: "6 セル · 入力 5", sum: 1234.5, preview: "1200 · 34.5 · Beta" });
    assert.ok(document.activeElement === active, "row refresh preserves the focused TD");
    await ui.render({ data: reordered });
    assertStatus(ui, { summary: "6 セル · 入力 6", sum: 1200, preview: "1200 · a · Beta" });
    await ui.render({ data: shrunk });
    assertStatus(ui, { summary: "TEXT", sum: 1200, preview: "1200" });
    assert.deepEqual(selected(ui), ["0:1"]);
    await ui.render({ data: { ...shrunk, rows: [] } });
    assertStatus(ui, { summary: "TEXT" });
    await ui.render({ data: { ...shrunk, columns: [] } });
    assertStatus(ui, { summary: "" });
    await ui.render({ data });
    assertStatus(ui, { summary: "TEXT · 必須 · PK", preview: "a" });
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 status: table, page, transport and opt-in reset the old selection summary", async () => {
  for (const change of ["table", "page", "transport", "opt-in"]) {
    const ui = await mount();
    try {
      await select(ui, "2:1");
      assertStatus(ui, { summary: "TEXT", preview: "Gamma" });
      const next = change === "table" ? { data: { ...data, def: { ...data.def, table: "events" } } }
        : change === "page" ? { data: { ...data, page: 3 } }
        : change === "opt-in" ? { allowMutations: true }
        : { fetchFn: async (...args) => { ui.calls.push(args); throw Error("status must not fetch"); } };
      await ui.render(next);
      assertStatus(ui, { summary: "TEXT · 必須 · PK", preview: "a" });
      assert.deepEqual(selected(ui), ["0:0"]);
      assert.ok(document.activeElement === cell(ui, "0:0"), "existing context reset owns focus");
      assertNoEffects(ui);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01 status: unsaved and invalidated drafts never replace displayed row statistics", async () => {
  const original = { ...data, rows: [{ ...data.rows[0], title: "12" }, ...data.rows.slice(1)] };
  const ui = await mount({ data: original, allowMutations: true });
  try {
    const input = await editTitle(ui);
    await setInput(input, "999");
    assertStatus(ui, { summary: "TEXT", sum: 12, preview: "12" });
    await ui.render({ data: { ...original, rows: [{ ...original.rows[0], note: "unrelated" }, ...data.rows.slice(1)] } });
    assertStatus(ui, { summary: "TEXT", sum: 12, preview: "12" });
    assert.ok(cell(ui, "0:1").querySelector("input") === input, "same live draft input retained");
    assert.ok(document.activeElement === input, "statistics never take draft focus");
    assert.equal(input.value, "999");
    await ui.render({ data: { ...original, rows: [{ ...original.rows[0], title: "34" }, ...data.rows.slice(1)] } });
    assertStatus(ui, { summary: "TEXT", sum: 34, preview: "34" });
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    assert.ok(cell(ui, "0:1").querySelector("input") === null, "conflicted draft stays hidden");
    await down(cell(ui, "2:2"));
    await up();
    assert.deepEqual(selected(ui), ["0:1"]);
    await ui.render({ data: original });
    assertStatus(ui, { summary: "TEXT", sum: 12, preview: "12" });
    assert.equal(button(ui, "1行 title を編集").disabled, true);
    await React.act(async () => button(ui, "編集を破棄").click());
    assertStatus(ui, { summary: "TEXT", sum: 12, preview: "12" });
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 status: Find keeps its query and active input while matched selection updates", async () => {
  const ui = await mount();
  try {
    await select(ui, "0:0");
    await select(ui, "1:1", { shiftKey: true });
    assertStatus(ui, { summary: "4 セル · 入力 4", preview: "a · Alpha · b" });
    await key(document.activeElement, "f", { ctrlKey: true });
    const search = ui.host.querySelector('input[type="search"]');
    assert.ok(search);
    await setInput(search, "Gamma");
    assertStatus(ui, { summary: "4 セル · 入力 4", preview: "a · Alpha · b" });
    await key(search, "Enter");
    assertStatus(ui, { summary: "TEXT", preview: "Gamma" });
    await ui.render({ data: { ...data, rows: [...data.rows.slice(0, 2), { ...data.rows[2], title: "Gamma updated" }] } });
    assertStatus(ui, { summary: "TEXT", preview: "Gamma updated" });
    assert.ok(ui.host.querySelector('input[type="search"]') === search, "same Find input retained");
    assert.ok(document.activeElement === search, "status changes preserve Find focus");
    assert.equal(search.value, "Gamma");
    assert.equal(cell(ui, "2:1").dataset.findMatch, "true");
    await key(search, "Escape");
    assertStatus(ui, { summary: "TEXT", preview: "Gamma updated" });
    assert.ok(document.activeElement === cell(ui, "2:1"), "existing Find close restores grid focus");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 status: pending save, refresh and history retain receipts without statistics effects", async () => {
  // Keep the save/refresh/replay lifetime together to detect an extra request, abort or receipt replacement at any stage.
  const requests = [];
  let releaseRefresh;
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => { refreshes++; if (refreshes === 1) return new Promise(resolve => { releaseRefresh = resolve; }); },
  });
  const success = () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  try {
    assertStatus(ui, { summary: "TEXT · 必須 · PK", preview: "a" });
    await editTitle(ui);
    await React.act(async () => button(ui, "セルを保存").click());
    assertStatus(ui, { summary: "TEXT", preview: "Alpha" });
    await select(ui, "1:1");
    assertStatus(ui, { summary: "TEXT", preview: "Beta" });
    assert.equal(requests.length, 1);
    await React.act(async () => requests[0].resolve(success()));
    assert.equal(refreshes, 1);
    const receipt = ui.host.querySelector('[role="status"]');
    assert.ok(receipt);
    assert.match(receipt.textContent, /保存しました/);
    await select(ui, "0:0");
    await select(ui, "2:2", { shiftKey: true });
    assertStatus(ui, { summary: "9 セル · 入力 8", preview: "a · Alpha · one" });
    assert.ok(ui.host.querySelector('[role="status"]') === receipt, "refresh keeps its mutation receipt");
    await React.act(async () => releaseRefresh());
    await key(document.activeElement, "z", { ctrlKey: true });
    await select(ui, "0:1");
    assertStatus(ui, { summary: "TEXT", preview: "Alpha" });
    assert.equal((await key(document.activeElement, "a", { ctrlKey: true })).defaultPrevented, false);
    assert.deepEqual(selected(ui), ["0:1"]);
    assert.deepEqual(requests.map(request => JSON.parse(request.init.body).value), ["Unsaved", "Alpha"]);
    assert.ok(requests.every(request => !request.init.signal.aborted), "statistics never abort mutations");
    await React.act(async () => requests[1].resolve(success()));
    assert.equal(refreshes, 2);
    assert.equal(requests.length, 2);
    assertStatus(ui, { summary: "TEXT", preview: "Alpha" });
    assert.match(ui.host.querySelector('[role="status"]').textContent, /保存しました/);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 status: explicit theme declarations stay scoped to the footer and preserve focus", async () => {
  const previous = document.documentElement.getAttribute("data-theme");
  const ui = await mount();
  const outside = document.createElement("div");
  document.body.append(outside);
  try {
    await select(ui, "1:1");
    const bar = assertStatus(ui, { summary: "TEXT", preview: "Beta" });
    const viewport = ui.host.querySelector("[data-spreadsheet-grid-viewport]");
    for (const [theme, background, border] of [
      ["light", "#f8f9fa", "#dadce0"],
      ["dark", "var(--bg-elevated, #252525)", "var(--border-subtle, #3c4043)"],
      ["light", "#f8f9fa", "#dadce0"],
    ]) {
      await React.act(async () => document.documentElement.setAttribute("data-theme", theme));
      const computed = window.getComputedStyle(bar);
      assert.equal(computed.getPropertyValue("--sheet-header-bg").trim(), background);
      assert.equal(computed.getPropertyValue("--sheet-border").trim(), border);
      for (const property of ["--sheet-header-bg", "--sheet-border"]) {
        assert.equal(window.getComputedStyle(outside).getPropertyValue(property), "", "no external status variable");
      }
      for (const [property, value] of Object.entries(sheetPalettes[theme])) {
        assert.equal(window.getComputedStyle(viewport).getPropertyValue(property).trim(), value, "unchanged viewport " + property);
      }
      assert.ok(ui.host.querySelector("[data-spreadsheet-grid-status]") === bar, "theme keeps the same footer");
      assert.ok(document.activeElement === cell(ui, "1:1"), "theme keeps grid focus");
      assertStatus(ui, { summary: "TEXT", preview: "Beta" });
      assertNoEffects(ui);
    }
  } finally {
    outside.remove();
    await ui.cleanup();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

test("MIG-0737 U01 status: fallback and preview declarations preserve full text without a native-layout claim", async () => {
  // CSSOM and selector applicability are deterministic; native layout, resolved colors and contrast remain NOT_RUN.
  const previous = document.documentElement.getAttribute("data-theme");
  const preview = "<b> long text </b> ".repeat(30);
  const ui = await mount({ data: { ...data, rows: [{ ...data.rows[0], title: preview }] } });
  try {
    await select(ui, "0:1");
    const bar = assertStatus(ui, { summary: "TEXT", preview });
    const rules = [...ui.host.querySelector("style").sheet.cssRules];
    const base = rules.find(rule => rule.selectorText === "[data-spreadsheet-grid-status]");
    const previewRule = rules.find(rule => rule.selectorText === "[data-spreadsheet-grid-status-preview]");
    const fallback = rules.filter(rule => rule.conditionText === "(prefers-color-scheme: dark)")
      .flatMap(rule => [...rule.cssRules]).find(rule => rule.selectorText?.includes("[data-spreadsheet-grid-status]"));
    assert.ok(base && previewRule && fallback, "scoped footer, preview and OS fallback rules");
    assert.equal(fallback.selectorText, ':root:not([data-theme="light"]):not([data-theme="dark"]) [data-spreadsheet-grid-status]');
    for (const [property, value] of Object.entries({ display: "flex", "flex-wrap": "wrap", "align-items": "center",
      gap: "12px", padding: "4px 10px", "font-size": "11px", color: "var(--text-muted)",
      "border-top": "1px solid var(--sheet-border)", background: "var(--sheet-header-bg)" })) {
      assert.equal(base.style.getPropertyValue(property).trim(), value, property);
    }
    for (const [property, value] of Object.entries({ flex: "1", "min-width": "0", overflow: "hidden",
      "text-overflow": "ellipsis", "white-space": "nowrap", "text-align": "right" })) {
      assert.equal(previewRule.style.getPropertyValue(property).trim(), value, property);
    }
    assert.ok(bar.lastElementChild.matches(previewRule.selectorText), "full preview uses its scoped ellipsis rule");
    assert.equal(fallback.style.getPropertyValue("--sheet-header-bg").trim(), "var(--bg-elevated, #252525)");
    assert.equal(fallback.style.getPropertyValue("--sheet-border").trim(), "var(--border-subtle, #3c4043)");
    for (const [theme, matches] of [[null, true], ["system", true], ["sepia", true], ["light", false], ["dark", false]]) {
      if (theme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", theme);
      assert.equal(bar.matches(fallback.selectorText), matches, "status fallback applicability for " + theme);
      assert.equal(ui.host.querySelector("[data-spreadsheet-grid-viewport]").matches(fallback.selectorText), false);
    }
    assertNoEffects(ui);
  } finally {
    await ui.cleanup();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

async function doubleClickCell(node, options = {}) {
  const event = mouse("dblclick", { detail: 2, ...options });
  await React.act(async () => node.dispatchEvent(event));
  return event;
}

test("MIG-0737 U01 double click: TD, display and empty value open the original draft and collapse a range", async () => {
  const fixture = { ...data, rows: [data.rows[0], data.rows[1], { ...data.rows[2], title: null }] };
  const ui = await mount({ data: fixture, allowMutations: true });
  try {
    for (const [pos, wrapped, value, options] of [
      ["1:1", false, "Beta", {}], ["0:1", true, "Alpha", { shiftKey: true }],
      ["2:1", true, "", { ctrlKey: true, altKey: true, metaKey: true }],
    ]) {
      await select(ui, "0:0");
      await select(ui, "2:2", { shiftKey: true });
      const td = cell(ui, pos);
      const surface = wrapped ? td.querySelector("[data-grid-cell-content]") : td;
      for (const detail of [1, 2]) {
        await down(surface, { ...options, detail });
        await up(surface, options);
        await terminalClick(surface, { ...options, detail });
        assert.equal(ui.host.querySelectorAll('input[type="text"]').length, 0);
      }
      assert.equal((await doubleClickCell(surface, options)).defaultPrevented, false);
      const input = td.querySelector('input[type="text"]');
      assert.ok(input && document.activeElement === input);
      assert.equal(input.value, value);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [value.length, value.length]);
      if (value.length > 0) {
        input.setSelectionRange(0, 1);
        await ui.render({});
        assert.ok(document.activeElement === input);
        assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 1],
          "same draft rerender must not move the caret");
      }
      assert.deepEqual(selected(ui), [pos]);
      assert.equal(ui.host.querySelectorAll('input[type="text"]').length, 1);
      await key(input, "Escape");
      assert.equal(td.querySelector("input"), null);
      assert.ok(document.activeElement === td);
    }
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 double click: denied cells, opt-in, generated and missing PK do not start an edit", async () => {
  for (const [fixture, allowMutations, positions] of [
    [data, false, ["1:1"]],
    [{ ...data, def: { ...data.def, mode: "readonly" } }, true, ["1:1"]],
    [data, true, ["1:0", "1:2"]],
    [{ ...data, columns: data.columns.map(c => c.name === "title" ? { ...c, generated: true } : c) }, true, ["1:1"]],
    [{ ...data, rows: [data.rows[0], { ...data.rows[1], id: null }, data.rows[2]] }, true, ["1:1"]],
  ]) {
    const ui = await mount({ data: fixture, allowMutations });
    try {
      for (const pos of positions) {
        const td = await select(ui, pos);
        await doubleClickCell(td);
        await doubleClickCell(td.querySelector("[data-grid-cell-content]"));
        assert.equal(ui.host.querySelectorAll('input[type="text"]').length, 0);
        assert.deepEqual(selected(ui), [pos]);
        assert.ok(document.activeElement === td);
      }
      assertNoEffects(ui);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01 double click: child and nonprimary gestures do not enter or replace a draft", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const td = await select(ui, "1:1");
    const display = td.querySelector("[data-grid-cell-content]");
    const edit = button(ui, "2行 title を編集");
    for (const target of [td, display]) {
      for (const button of [1, 2]) await doubleClickCell(target, { button });
    }
    await doubleClickCell(edit);
    assert.equal(td.querySelector("input"), null);
    await doubleClickCell(display);
    const input = td.querySelector("input");
    assert.ok(input && document.activeElement === input);
    await setInput(input, "Unsaved");
    await doubleClickCell(input);
    await doubleClickCell(button(ui, "セルを保存"));
    await doubleClickCell(button(ui, "キャンセル"));
    await doubleClickCell(cell(ui, "0:1").querySelector("[data-grid-cell-content]"));
    assert.ok(td.querySelector("input") === input);
    assert.equal(input.value, "Unsaved");
    assert.deepEqual(selected(ui), ["1:1"]);
    assert.ok(document.activeElement === input);
    await key(input, "Escape");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 double click: mixed same-batch entry keeps the first draft and invalidation fences reopen", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const first = await select(ui, "0:1");
    const second = cell(ui, "1:1");
    const other = button(ui, "2行 title を編集");
    const f2 = new dom.window.KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    await React.act(async () => {
      first.dispatchEvent(f2);
      second.dispatchEvent(mouse("dblclick", { detail: 2 }));
      other.click();
    });
    assert.equal(f2.defaultPrevented, true);
    const input = first.querySelector("input");
    assert.ok(input);
    assert.equal(input.value, "Alpha");
    assert.equal(second.querySelector("input"), null);
    await setInput(input, "Unsaved");
    await ui.render({ data: { ...data, rows: [{ ...data.rows[0], title: "Server change" }, ...data.rows.slice(1)] } });
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    await doubleClickCell(second);
    assert.equal(second.querySelector("input"), null);
    await React.act(async () => button(ui, "編集を破棄").click());
    await doubleClickCell(second);
    const reopened = second.querySelector("input");
    assert.ok(reopened && document.activeElement === reopened);
    assert.equal(reopened.value, "Beta");
    await key(reopened, "Escape");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 double click: pending ordinary write and history preserve mutation ownership", async () => {
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => { refreshes++; },
  });
  const success = () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  try {
    await editTitle(ui);
    await React.act(async () => button(ui, "セルを保存").click());
    assert.equal(requests.length, 1);
    const other = await select(ui, "1:1");
    await doubleClickCell(other);
    assert.equal(other.querySelector("input"), null);
    assert.equal(requests[0].init.signal.aborted, false);
    assert.equal(requests.length, 1);
    await React.act(async () => requests[0].resolve(success()));
    assert.equal(refreshes, 1);
    await key(other, "z", { ctrlKey: true });
    assert.equal(requests.length, 2);
    await doubleClickCell(other);
    assert.equal(other.querySelector("input"), null);
    assert.equal(requests[1].init.signal.aborted, false);
    await React.act(async () => requests[1].resolve(success()));
    assert.equal(refreshes, 2);
    await doubleClickCell(other);
    const input = other.querySelector("input");
    assert.ok(input);
    assert.equal(input.value, "Beta");
    await key(input, "Escape");
    assert.equal(requests.length, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 double click: same-cell batched cancel/reopen restores focus and original-value caret", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const td = await select(ui, "1:1");
    assert.equal((await key(td, "x")).defaultPrevented, true);
    const typed = td.querySelector("input");
    assert.ok(typed && document.activeElement === typed);
    assert.equal(typed.value, "x");
    assert.deepEqual([typed.selectionStart, typed.selectionEnd], [0, 1]);
    const cancel = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const reopen = mouse("dblclick", { detail: 2 });
    await React.act(async () => { typed.dispatchEvent(cancel); td.dispatchEvent(reopen); });
    assert.equal(cancel.defaultPrevented, true);
    const original = td.querySelector("input");
    assert.ok(original && document.activeElement === original);
    assert.equal(original.value, "Beta");
    assert.deepEqual([original.selectionStart, original.selectionEnd], [4, 4]);
    original.setSelectionRange(1, 2);
    await ui.render({});
    assert.ok(document.activeElement === original);
    assert.deepEqual([original.selectionStart, original.selectionEnd], [1, 2]);
    const cancelAgain = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const f2 = new dom.window.KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    await React.act(async () => { original.dispatchEvent(cancelAgain); td.dispatchEvent(f2); });
    assert.equal(cancelAgain.defaultPrevented, true);
    assert.equal(f2.defaultPrevented, true);
    const f2Input = td.querySelector("input");
    assert.ok(f2Input && document.activeElement === f2Input);
    assert.equal(f2Input.value, "Beta");
    assert.deepEqual([f2Input.selectionStart, f2Input.selectionEnd], [4, 4]);
    await key(f2Input, "Escape");
    assert.ok(document.activeElement === td);
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 double click: explicit save, undo and redo retain opened row identity and original value", async () => {
  for (const [position, original, id, next] of [
    ["1:1", "Beta", "b", "Changed"],
    ["2:1", null, "c", "New title"],
    ["0:1", "Alpha", "a", "NULL"],
  ]) {
    const requests = [];
    let refreshes = 0;
    const fixture = { ...data, rows: [data.rows[0], data.rows[1], { ...data.rows[2], title: null }] };
    const ui = await mount({ data: fixture, allowMutations: true,
      fetchFn: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      },
      onRefresh: () => { refreshes++; },
    });
    try {
      const td = await select(ui, position);
      const surface = td.querySelector("[data-grid-cell-content]");
      await doubleClickCell(surface);
      const input = td.querySelector("input");
      assert.ok(input && document.activeElement === input);
      assert.equal(input.value, original ?? "");
      await setInput(input, next);
      const other = cell(ui, position === "0:1" ? "1:1" : "0:1");
      await doubleClickCell(other.querySelector("[data-grid-cell-content]"));
      assert.ok(td.querySelector("input") === input);
      assert.equal(other.querySelector("input"), null);
      assert.deepEqual(selected(ui), [position]);
      assert.equal(requests.length, 0);
      const save = button(ui, "セルを保存");
      await React.act(async () => { save.click(); save.click(); });
      assert.equal(requests.length, 1);
      assert.equal(refreshes, 1);
      assert.equal(td.querySelector("input"), null);
      await select(ui, position);
      assert.equal((await key(td, "z", { ctrlKey: true })).defaultPrevented, true);
      assert.equal(requests.length, 2);
      assert.equal(refreshes, 2);
      await select(ui, position);
      assert.equal((await key(td, "z", { ctrlKey: true, shiftKey: true })).defaultPrevented, true);
      assert.equal(requests.length, 3);
      assert.equal(refreshes, 3);
      const after = next === "NULL" ? null : next;
      assert.deepEqual(requests.map(({ url, init }) => [url, init.method, JSON.parse(init.body)]),
        [after, original, after].map(value => ["/api/admin/spreadsheet/data", "PATCH",
          { table: "videos", primaryKey: { id }, column: "title", value }]));
      assert.ok(requests.every(({ init }) => !init.signal.aborted));
    } finally { await ui.cleanup(); }
  }
});


test("MIG-0737 U01 editor copy: delivered lower-case Ctrl/Cmd+C copies the whole live draft, not the selected substring", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async value => { copied.push(value); },
  } });
  const ui = await mount({ allowMutations: true });
  try {
    const input = await editTitle(ui);
    const value = 'Draft <>& "日本語"';
    await setInput(input, value);
    input.setSelectionRange(1, 3, "backward");
    for (let mask = 0; mask < 16; mask++) {
      const modifiers = { ctrlKey: Boolean(mask & 1), metaKey: Boolean(mask & 2),
        altKey: Boolean(mask & 4), shiftKey: Boolean(mask & 8) };
      for (const character of ["c", "C", "x"]) {
        const before = copied.length;
        const expected = character === "c" && (modifiers.ctrlKey || modifiers.metaKey);
        assert.equal((await key(input, character, modifiers)).defaultPrevented, expected);
        assert.deepEqual(copied.slice(before), expected ? [value] : []);
        assert.equal(input.value, value);
        assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [1, 3, "backward"]);
        assert.ok(document.activeElement === input);
      }
    }
    await setInput(input, "");
    assert.equal((await key(input, "c", { metaKey: true })).defaultPrevented, true);
    assert.equal(copied.at(-1), "");
    assert.deepEqual(selected(ui), ["0:1"]);
    assertNoEffects(ui);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});

test("MIG-0737 U01 editor copy: unavailable/rejected Clipboard API falls back and always removes the temporary textarea", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const previousExec = Object.getOwnPropertyDescriptor(document, "execCommand");
  try {
    for (const mode of ["unavailable", "reject", "throw"]) {
      const calls = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: mode === "unavailable"
        ? undefined : { writeText: async () => { throw Error("denied"); } } });
      Object.defineProperty(document, "execCommand", { configurable: true, value: command => {
        const textarea = document.activeElement;
        calls.push([command, textarea.tagName, textarea.value, textarea.hasAttribute("readonly"),
          textarea.selectionStart, textarea.selectionEnd]);
        if (mode === "throw") throw Error("fallback denied");
        return true;
      } });
      const ui = await mount({ allowMutations: true });
      try {
        const input = await editTitle(ui);
        input.setSelectionRange(1, 3, "backward");
        const before = document.querySelectorAll("textarea").length;
        assert.equal((await key(input, "c", { ctrlKey: true })).defaultPrevented, true);
        assert.deepEqual(calls, [["copy", "TEXTAREA", "Unsaved", true, 0, 7]]);
        assert.equal(document.querySelectorAll("textarea").length, before);
        assert.ok(document.activeElement === input);
        assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [1, 3, "backward"]);
        assert.equal(input.value, "Unsaved");
        assertNoEffects(ui);
      } finally { await ui.cleanup(); }
    }
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
    if (previousExec) Object.defineProperty(document, "execCommand", previousExec);
    else delete document.execCommand;
  }
});

test("MIG-0737 U01 editor copy: late clipboard rejection cannot retry after draft, page or focus changes", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const previousExec = Object.getOwnPropertyDescriptor(document, "execCommand");
  let fallbackCalls = 0;
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => { fallbackCalls++; return true; } });
  try {
    for (const mode of ["value", "reopen", "page", "focus", "context"]) {
      let rejectCopy;
      const copied = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: value => { copied.push(value); return new Promise((_, reject) => { rejectCopy = reject; }); },
      } });
      const ui = await mount({ allowMutations: true });
      const external = document.createElement("button");
      document.body.append(external);
      try {
        const input = await editTitle(ui);
        assert.equal((await key(input, "c", { ctrlKey: true })).defaultPrevented, true);
        assert.deepEqual(copied, ["Unsaved"]);
        if (mode === "value") await setInput(input, "New draft");
        else if (mode === "reopen") {
          await key(input, "Escape");
          await doubleClickCell(cell(ui, "0:1"));
          assert.equal(cell(ui, "0:1").querySelector("input").value, "Alpha");
        } else if (mode === "page") await ui.render({ data: { ...data } });
        else if (mode === "focus") external.focus();
        else await ui.render({ data: { ...data, page: data.page + 1 } });
        await React.act(async () => rejectCopy(Error("late denial")));
        assert.equal(fallbackCalls, 0);
        if (mode === "focus") assert.ok(document.activeElement === external);
        if (mode === "value") assert.equal(input.value, "New draft");
        assertNoEffects(ui);
      } finally { await ui.cleanup(); external.remove(); }
    }
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
    if (previousExec) Object.defineProperty(document, "execCommand", previousExec);
    else delete document.execCommand;
  }
});

test("MIG-0737 U01 editor copy: retired same-batch input cannot write to the clipboard", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { copied.push(value); } } });
  const ui = await mount({ allowMutations: true });
  try {
    const input = await editTitle(ui);
    const cancel = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const copy = new dom.window.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    await React.act(async () => { input.dispatchEvent(cancel); input.dispatchEvent(copy); });
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(copy.defaultPrevented, true);
    assert.deepEqual(copied, []);
    assert.equal(cell(ui, "0:1").querySelector("input"), null);
    assertNoEffects(ui);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});


test("MIG-0737 U01 editor copy: synchronous focus takeover during fallback never copies another control", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const previousExec = Object.getOwnPropertyDescriptor(document, "execCommand");
  const selectPrototype = dom.window.HTMLTextAreaElement.prototype;
  const previousSelect = Object.getOwnPropertyDescriptor(selectPrototype, "select");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async () => { throw Error("denied"); },
  } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: command => {
    copied.push([command, document.activeElement]);
    return true;
  } });
  try {
    for (const phase of ["focus", "select"]) {
      const ui = await mount({ allowMutations: true });
      const outside = document.createElement("input");
      outside.value = "Other selection";
      document.body.append(outside);
      let redirected = 0;
      const redirect = () => {
        redirected++;
        outside.focus();
        outside.select();
      };
      const onFocus = event => {
        if (phase === "focus" && event.target.tagName === "TEXTAREA") redirect();
      };
      document.addEventListener("focusin", onFocus);
      if (phase === "select") Object.defineProperty(selectPrototype, "select", {
        ...previousSelect, value: function () {
          previousSelect.value.call(this);
          redirect();
        },
      });
      try {
        const input = await editTitle(ui);
        input.setSelectionRange(1, 3, "backward");
        const count = document.querySelectorAll("textarea").length;
        assert.equal((await key(input, "c", { ctrlKey: true })).defaultPrevented, true);
        assert.equal(redirected, 1);
        assert.deepEqual(copied, []);
        assert.equal(document.activeElement, outside);
        assert.deepEqual([outside.selectionStart, outside.selectionEnd], [0, outside.value.length]);
        assert.equal(document.querySelectorAll("textarea").length, count);
        assert.equal(input.value, "Unsaved");
        assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [1, 3, "backward"]);
        assertNoEffects(ui);
      } finally {
        document.removeEventListener("focusin", onFocus);
        Object.defineProperty(selectPrototype, "select", previousSelect);
        outside.remove();
        await ui.cleanup();
      }
    }
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
    if (previousExec) Object.defineProperty(document, "execCommand", previousExec);
    else delete document.execCommand;
  }
});

function assertFormula(ui, reference, value, status = "") {
  const bar = ui.host.querySelector("[data-spreadsheet-formula-bar]");
  assert.ok(bar);
  assert.equal(bar.getAttribute("aria-label"), "数式バー（表示専用）");
  assert.equal(bar.querySelector("[data-spreadsheet-formula-reference]").textContent, reference);
  assert.equal(bar.querySelector("[data-spreadsheet-formula-reference]").getAttribute("aria-live"), "polite");
  assert.equal(bar.querySelector("[data-spreadsheet-formula-fx]").textContent, "fx");
  const display = bar.querySelector("[data-spreadsheet-formula-value]");
  assert.equal(display.textContent, value);
  assert.equal(display.title, value);
  assert.equal(bar.querySelector("[data-spreadsheet-formula-status]").textContent, status);
  assert.equal(bar.querySelector("input,textarea,button,[contenteditable]"), null);
  return bar;
}

test("MIG-0737 U01 formula display: page-relative A1 reference, endpoint value and range summary", async () => {
  const ui = await mount();
  try {
    assertFormula(ui, "A4 (id)", "a");
    const td = await select(ui, "1:1");
    const bar = assertFormula(ui, "B5 (title)", "Beta");
    assert.ok(document.activeElement === td);
    await select(ui, "0:0");
    await select(ui, "2:2", { shiftKey: true });
    assertFormula(ui, "C6 (note)", "", "9 セル");
    assert.ok(ui.host.querySelector("[data-spreadsheet-formula-bar]") === bar);
    assert.ok(document.activeElement === cell(ui, "2:2"));
    await key(document.activeElement, "ArrowLeft");
    assertFormula(ui, "B6 (title)", "Gamma");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 formula display: column letters beyond Z, escaped values and empty dimensions", async () => {
  const columns = Array.from({ length: 28 }, (_, i) => ({
    name: "col" + i, type: "TEXT", editable: false, pk: 0, notNull: false,
  }));
  const long = "  <b> & value  ";
  const fixture = { ...data, columns, rows: [{ col0: null, col26: { nested: true }, col27: long }], primaryKeys: [], page: 3, limit: 10 };
  const ui = await mount({ data: fixture });
  try {
    assertFormula(ui, "A21 (col0)", "");
    await select(ui, "0:26");
    assertFormula(ui, "AA21 (col26)", '{"nested":true}');
    await select(ui, "0:27");
    const bar = assertFormula(ui, "AB21 (col27)", long);
    assert.equal(bar.querySelector("b"), null, "value is text, not markup");
    await ui.render({ data: { ...fixture, rows: [] } });
    assertFormula(ui, "AB21 (col27)", "");
    await ui.render({ data: { ...fixture, rows: [], columns: [] } });
    assertFormula(ui, "—", "");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 formula display: mirrors live draft without writes and hides invalidated draft", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const td = await select(ui, "1:1");
    await key(td, "x");
    const input = td.querySelector("input");
    assert.ok(input && document.activeElement === input);
    assertFormula(ui, "B5 (title)", "x");
    await setInput(input, "  Unsaved  ");
    const bar = assertFormula(ui, "B5 (title)", "  Unsaved  ");
    assert.ok(document.activeElement === input);
    await React.act(async () => bar.querySelector("[data-spreadsheet-formula-value]").dispatchEvent(mouse("dblclick", { detail: 2 })));
    assert.equal(input.value, "  Unsaved  ");
    assertNoEffects(ui);
    await ui.render({ data: { ...data, rows: [data.rows[0], { ...data.rows[1], title: "Server change" }, data.rows[2]] } });
    assertFormula(ui, "B5 (title)", "Server change");
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    await React.act(async () => button(ui, "編集を破棄").click());
    assertFormula(ui, "B5 (title)", "Server change");
    await select(ui, "0:1");
    await doubleClickCell(cell(ui, "0:1"));
    const newInput = cell(ui, "0:1").querySelector("input");
    await setInput(newInput, "Discard me");
    assertFormula(ui, "B4 (title)", "Discard me");
    await key(newInput, "Escape");
    assertFormula(ui, "B4 (title)", "Alpha");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 formula display: Find and context resets use the current displayed endpoint", async () => {
  const ui = await mount();
  try {
    await select(ui, "0:1");
    await key(document.activeElement, "f", { ctrlKey: true });
    const search = ui.host.querySelector('input[type="search"]');
    await setInput(search, "Beta");
    await key(search, "Enter");
    assertFormula(ui, "B5 (title)", "Beta");
    assert.ok(document.activeElement === search);
    await setInput(search, "no matching cell");
    await key(search, "Enter");
    assertFormula(ui, "B5 (title)", "Beta", "見つかりません");
    await ui.render({ data: { ...data, page: 3, rows: [{ id: "new", title: "Fresh", note: "" }] } });
    assertFormula(ui, "A7 (id)", "new");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 formula display: save and history busy precedence with no duplicate request", async () => {
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: (_, init) => new Promise(resolve => requests.push({ init, resolve })),
    onRefresh: () => { refreshes++; },
  });
  const success = () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  try {
    await editTitle(ui);
    assertFormula(ui, "B4 (title)", "Unsaved");
    await React.act(async () => button(ui, "セルを保存").click());
    assertFormula(ui, "B4 (title)", "Alpha", "保存中…");
    assert.equal(requests.length, 1);
    await select(ui, "1:1");
    assertFormula(ui, "B5 (title)", "Beta", "保存中…");
    await React.act(async () => requests[0].resolve(success()));
    assertFormula(ui, "B5 (title)", "Beta", "保存しました。");
    await key(document.activeElement, "z", { ctrlKey: true });
    assertFormula(ui, "B5 (title)", "Beta", "履歴を適用中…");
    assert.equal(requests.length, 2);
    await React.act(async () => requests[1].resolve(success()));
    assertFormula(ui, "B5 (title)", "Beta", "保存しました。");
    assert.equal(refreshes, 2);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(r => !r.init.signal.aborted));
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 formula display: theme switching preserves node, draft and scoped declarations", async () => {
  const previous = document.documentElement.getAttribute("data-theme");
  const ui = await mount({ allowMutations: true });
  const outside = document.createElement("div");
  document.body.append(outside);
  try {
    await editTitle(ui);
    const input = cell(ui, "0:1").querySelector("input");
    const bar = assertFormula(ui, "B4 (title)", "Unsaved");
    for (const [theme, bg, border] of [
      ["light", "#ffffff", "#dadce0"],
      ["dark", "var(--bg-base, #1a1a1a)", "var(--border-subtle, #3c4043)"],
      ["light", "#ffffff", "#dadce0"],
    ]) {
      await React.act(async () => document.documentElement.setAttribute("data-theme", theme));
      assert.ok(assertFormula(ui, "B4 (title)", "Unsaved") === bar);
      assert.ok(document.activeElement === input);
      const computed = window.getComputedStyle(bar);
      assert.equal(computed.getPropertyValue("--sheet-bg").trim(), bg);
      assert.equal(computed.getPropertyValue("--sheet-border").trim(), border);
      assert.equal(window.getComputedStyle(outside).getPropertyValue("--sheet-bg").trim(), "");
    }
    assertNoEffects(ui);
  } finally {
    outside.remove();
    await ui.cleanup();
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});


test("MIG-0737 U01 formula display: live copy and readonly projection share the same draft without saving", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async value => { copied.push(value); },
  } });
  const ui = await mount({ allowMutations: true });
  try {
    const input = await editTitle(ui);
    const value = "  日本語 <draft>  ";
    await setInput(input, value);
    const bar = assertFormula(ui, "B4 (title)", value);
    input.setSelectionRange(2, 5, "backward");
    assert.equal((await key(input, "c", { ctrlKey: true })).defaultPrevented, true);
    assert.deepEqual(copied, [value]);
    assert.ok(assertFormula(ui, "B4 (title)", value) === bar);
    assert.ok(document.activeElement === input);
    assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [2, 5, "backward"]);
    assertNoEffects(ui);
    await key(input, "Escape");
    assertFormula(ui, "B4 (title)", "Alpha");
    assert.deepEqual(copied, [value]);
    assertNoEffects(ui);
  } finally {
    await ui.cleanup();
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else delete navigator.clipboard;
  }
});


test("MIG-0737 U01 formula display: valid draft label follows its named column through reorder and removal", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const input = await editTitle(ui);
    const bar = assertFormula(ui, "B4 (title)", "Unsaved");
    input.setSelectionRange(1, 3, "backward");
    const reordered = { ...data, columns: [data.columns[2], data.columns[0], data.columns[1]] };
    await ui.render({ data: reordered });
    assert.ok(assertFormula(ui, "C4 (title)", "Unsaved") === bar);
    assert.ok(cell(ui, "0:2").querySelector("input") === input);
    assert.equal(input.value, "Unsaved");
    assertNoEffects(ui);
    const shrunk = { ...reordered, columns: [data.columns[1], data.columns[0]] };
    await ui.render({ data: shrunk });
    assertFormula(ui, "A4 (title)", "Unsaved");
    assert.ok(cell(ui, "0:0").querySelector("input") === input);
    assertNoEffects(ui);
    await ui.render({ data: { ...shrunk, columns: [data.columns[2], data.columns[0]] } });
    assertFormula(ui, "B4 (id)", "a");
    assert.equal(ui.host.querySelector("input"), null);
    assert.match(ui.host.textContent, /編集中の行または列の状態が変更/);
    await React.act(async () => button(ui, "編集を破棄").click());
    assertFormula(ui, "B4 (id)", "a");
    assertNoEffects(ui);
  } finally { await ui.cleanup(); }
});

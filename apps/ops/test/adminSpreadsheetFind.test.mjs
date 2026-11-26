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

const columns = [
  { name: "id", type: "TEXT", editable: false, pk: 1, notNull: true },
  { name: "title", type: "TEXT", editable: true, pk: 0, notNull: false },
  { name: "note", type: "TEXT", editable: false, pk: 0, notNull: false },
];
const data = {
  def: { table: "videos", label: "動画", group: "content", mode: "editable" },
  columns,
  primaryKeys: ["id"],
  rows: [
    { id: "a1", title: "Alpha", note: "first" },
    { id: "b2", title: "Beta", note: "second" },
    { id: "c3", title: "Gamma", note: "third" },
  ],
  page: 2, limit: 3, hasMore: true,
};
const writeOk = () => new Response(JSON.stringify({ ok: true }), {
  headers: { "content-type": "application/json" },
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() {
  await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
}
async function mount(props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const effects = { requests: [], refreshes: 0, copied: [], scrolled: [] };
  const oldScroll = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "scrollIntoView");
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true, value(options) { effects.scrolled.push({ cell: this.dataset.gridCell, options }); },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async value => { effects.copied.push(value); } },
  });
  const restore = () => {
    if (oldScroll) Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", oldScroll);
    else delete dom.window.HTMLElement.prototype.scrollIntoView;
    if (oldClipboard) Object.defineProperty(navigator, "clipboard", oldClipboard);
    else delete navigator.clipboard;
  };
  let currentProps = {
    data, allowMutations: false,
    onRefresh: () => { effects.refreshes++; },
    fetchFn: async (path, init) => { effects.requests.push({ path, init }); throw Error("Find must not fetch"); },
    ...props,
  };
  const render = async (next = {}) => {
    currentProps = { ...currentProps, ...next };
    await React.act(async () => root.render(React.createElement(AdminSpreadsheetEditableGrid, currentProps)));
  };
  const cleanup = async () => {
    try { await React.act(async () => root.unmount()); }
    finally { host.remove(); restore(); }
  };
  try { await render(); }
  catch (error) { await cleanup(); throw error; }
  return { host, effects, render, cleanup };
}
function cell(ui, position) {
  const found = ui.host.querySelector(`[data-grid-cell="${position}"]`);
  assert.ok(found, "missing grid cell " + position);
  return found;
}
function selected(ui) {
  return [...ui.host.querySelectorAll('[data-grid-cell][aria-selected="true"]')].map(node => node.dataset.gridCell);
}
function matches(ui) {
  return [...ui.host.querySelectorAll('[data-grid-cell][data-find-match="true"]')].map(node => node.dataset.gridCell);
}
function button(ui, name) {
  const found = [...ui.host.querySelectorAll("button")].find(node =>
    node.textContent.trim() === name || node.getAttribute("aria-label") === name);
  assert.ok(found, "missing button " + name);
  return found;
}
function search(ui) {
  const input = ui.host.querySelector('input[type="search"]');
  assert.ok(input, "missing page-local Find input");
  return input;
}
function keyEvent(key, options = {}) {
  return new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
}
async function press(target, key, options = {}) {
  const event = keyEvent(key, options);
  await React.act(async () => target.dispatchEvent(event));
  return event;
}
async function click(ui, name) {
  const target = button(ui, name);
  assert.equal(target.disabled, false, "disabled button " + name);
  await React.act(async () => target.click());
}
async function select(ui, position) {
  const target = cell(ui, position);
  await React.act(async () => {
    const down = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1 });
    target.dispatchEvent(down);
    // JSDOM does not execute the browser's default mousedown focus action.
    if (!down.defaultPrevented) target.focus();
    target.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, button: 0, detail: 1 }));
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
  });
  return target;
}
async function inputValue(input, value) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function openFind(ui, position = "0:0", options = { ctrlKey: true }) {
  const target = await select(ui, position);
  assert.equal((await press(target, "f", options)).defaultPrevented, true);
  return search(ui);
}
function statusText(ui) {
  return [...ui.host.querySelectorAll('[role="status"]')].map(node => node.textContent).join("\n");
}
function assertNoFindEffects(ui) {
  assert.equal(ui.effects.requests.length, 0);
  assert.equal(ui.effects.refreshes, 0);
  assert.deepEqual(ui.effects.copied, []);
}
function hintClock() {
  const pending = new Map();
  let now = 0;
  let nextId = -1;
  const originals = [globalThis, window].map(owner => ({
    owner, set: owner.setTimeout, clear: owner.clearTimeout,
  }));
  for (const { owner, set, clear } of originals) {
    owner.setTimeout = (callback, delay, ...args) => {
      if (delay !== 3500 || typeof callback !== "function") return set.call(owner, callback, delay, ...args);
      const id = nextId--;
      pending.set(id, { at: now + delay, callback: () => callback(...args) });
      return id;
    };
    owner.clearTimeout = id => {
      if (!pending.delete(id)) clear.call(owner, id);
    };
  }
  return {
    tick(milliseconds) {
      now += milliseconds;
      for (const [id, item] of pending) {
        if (item.at <= now) { pending.delete(id); item.callback(); }
      }
    },
    restore() {
      for (const { owner, set, clear } of originals) { owner.setTimeout = set; owner.clearTimeout = clear; }
      pending.clear();
    },
  };
}

for (const [name, modifiers] of [
  ["Ctrl", { ctrlKey: true }], ["Cmd", { metaKey: true }], ["Ctrl+Alt", { ctrlKey: true, altKey: true }],
]) {
  test(`MIG-0737 U01 Find: ${name}+lowercase f opens and focuses the labelled readonly search`, async () => {
    const ui = await mount();
    try {
      const input = await openFind(ui, "0:1", modifiers);
      assert.equal(document.activeElement === input, true);
      assert.equal(input.disabled, false);
      assert.equal(input.value, "");
      assert.match(input.closest("label")?.textContent ?? "", /検索/);
      assert.equal(button(ui, "次へ").disabled, false);
      assert.equal(button(ui, "閉じる").disabled, false);
      assert.equal(ui.host.querySelector("table").tabIndex, -1);
      assert.deepEqual(selected(ui), ["0:1"]);
      assertNoFindEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 Find: uppercase F and unmodified f keep their native key ownership", async () => {
  const ui = await mount();
  try {
    const target = await select(ui, "0:0");
    for (const [key, options] of [["F", { ctrlKey: true }], ["F", { metaKey: true }], ["f", {}]]) {
      assert.equal((await press(target, key, options)).defaultPrevented, false);
      assert.equal(ui.host.querySelector('input[type="search"]') === null, true);
    }
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: child buttons and active editor inputs own their Ctrl+f", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const target = await select(ui, "0:1");
    assert.equal((await press(target.querySelector("button"), "f", { ctrlKey: true })).defaultPrevented, false);
    assert.equal(ui.host.querySelector('input[type="search"]') === null, true);
    await press(target, "Enter");
    const editor = target.querySelector('input[type="text"]');
    assert.ok(editor);
    await inputValue(editor, "Uncommitted value");
    assert.equal((await press(editor, "f", { metaKey: true })).defaultPrevented, false);
    assert.equal(ui.host.querySelector('input[type="search"]') === null, true);
    assert.equal(document.activeElement === editor, true);
    assert.equal(editor.value, "Uncommitted value");
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: repeating the shortcut on an already open bar preserves CURRENT focus", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    const target = await select(ui, "1:0");
    await press(target, "f", { ctrlKey: true });
    assert.equal(search(ui) === input, true);
    assert.equal(input.value, "Beta");
    assert.equal(document.activeElement === target, true);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: literal matches advance row-major and wrap before the current origin", async () => {
  const ui = await mount({ data: { ...data, rows: [
    { id: "r0", title: "hit before", note: "zero" },
    { id: "r1", title: "HIT origin", note: "Hit same row" },
    { id: "r2", title: "hit next row", note: "last" },
  ] } });
  try {
    const input = await openFind(ui, "1:1");
    await inputValue(input, "HiT");
    assert.deepEqual(matches(ui), ["0:1", "1:1", "1:2", "2:1"]);
    for (const position of ["1:2", "2:1", "0:1", "1:1"]) {
      await press(input, "Enter");
      assert.deepEqual(selected(ui), [position]);
      assert.equal(document.activeElement === input, true);
    }
    assert.match(statusText(ui), /先頭から検索/);
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: a range search starts after its focused endpoint and collapses the range", async () => {
  const ui = await mount({ data: { ...data, rows: data.rows.map(row => ({ ...row, title: "Hit " + row.title })) } });
  try {
    const first = await select(ui, "0:1");
    await press(first, "ArrowDown", { shiftKey: true });
    const endpoint = cell(ui, "1:1");
    assert.deepEqual(selected(ui), ["0:1", "1:1"]);
    await press(endpoint, "f", { ctrlKey: true });
    const input = search(ui);
    await inputValue(input, "hit");
    assert.deepEqual(selected(ui), ["0:1", "1:1"]);
    await press(input, "Enter", { shiftKey: true });
    assert.deepEqual(selected(ui), ["2:1"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: a current-cell-only match is highlighted but never returned", async () => {
  const ui = await mount({ data: { ...data, columns: [columns[1]], rows: [{ title: "only" }] } });
  try {
    const input = await openFind(ui);
    await inputValue(input, "only");
    assert.deepEqual(matches(ui), ["0:0"]);
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["0:0"]);
    assert.match(statusText(ui), /見つかりません/);
    assert.equal(document.activeElement === input, true);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: numbers, boolean and JSON display text match while null stays empty", async () => {
  const ui = await mount({ data: { ...data, rows: [
    { id: "n1", title: 42, note: { Name: "Hello" } },
    { id: "n2", title: null, note: false },
  ] } });
  try {
    const input = await openFind(ui);
    for (const [query, expected] of [["42", ["0:1"]], ['"name":"hello"', ["0:2"]], ["FALSE", ["1:2"]], ["NULL", []]]) {
      await inputValue(input, query);
      assert.deepEqual(matches(ui), expected);
      assert.deepEqual(selected(ui), ["0:0"], "typing must not move selection");
    }
    await press(input, "Enter");
    assert.match(statusText(ui), /見つかりません/);
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: meaningful spaces are retained and blank-only query highlights without navigation", async () => {
  const ui = await mount({ data: { ...data, rows: [
    { id: "a", title: " foo ", note: "one" },
    { id: "b", title: "foo", note: "two" },
    { id: "c", title: " ", note: "three" },
  ] } });
  try {
    const input = await openFind(ui);
    await inputValue(input, " foo ");
    assert.deepEqual(matches(ui), ["0:1"]);
    await inputValue(input, "foo");
    assert.deepEqual(matches(ui), ["0:1", "1:1"]);
    await inputValue(input, " ");
    assert.deepEqual(matches(ui), ["0:1", "2:1"]);
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["0:0"]);
    assert.match(statusText(ui), /見つかりません/);
    await inputValue(input, "");
    assert.deepEqual(matches(ui), []);
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["0:0"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: regex-looking and HTML-looking text remain literal escaped data", async () => {
  const unsafe = '<img src="x" onerror="alert(1)">';
  const ui = await mount({ data: { ...data, rows: [{ id: "a", title: unsafe, note: ".*" }] } });
  try {
    const input = await openFind(ui);
    await inputValue(input, ".*");
    assert.deepEqual(matches(ui), ["0:2"]);
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["0:2"]);
    await inputValue(input, "<IMG");
    assert.deepEqual(matches(ui), ["0:1"]);
    assert.equal(ui.host.querySelectorAll("img, script").length, 0);
    assert.equal(cell(ui, "0:1").textContent.includes(unsafe), true);
    const style = cell(ui, "0:1").style;
    assert.equal(Boolean(style.background || style.backgroundColor), true, "match needs a visible background");
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: PK and readonly data participate but headers, actions and other pages do not", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const input = await openFind(ui);
    for (const [query, expected] of [["B2", ["1:0"]], ["SECOND", ["1:2"]], ["title", []], ["編集", []], ["unloaded page", []]]) {
      await inputValue(input, query);
      assert.deepEqual(matches(ui), expected);
      await press(input, "Enter");
    }
    await press(input, "Escape");
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: Enter keeps input focus and scrolls only the matching cell nearest", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    ui.effects.scrolled.length = 0;
    await press(input, "Enter");
    assert.equal(document.activeElement === input, true);
    assert.deepEqual(selected(ui), ["1:1"]);
    assert.deepEqual(ui.effects.scrolled, [{ cell: "1:1", options: { block: "nearest", inline: "nearest" } }]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: clicking Next retains the button's actual focus", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    const next = button(ui, "次へ");
    await React.act(async () => { next.focus(); next.click(); });
    assert.equal(document.activeElement === next, true);
    assert.deepEqual(selected(ui), ["1:1"]);
    assert.equal(search(ui) === input, true);
  } finally { await ui.cleanup(); }
});

for (const method of ["button", "Escape"]) {
  test(`MIG-0737 U01 Find: ${method} close retains query and highlights and returns grid navigation`, async () => {
    const ui = await mount();
    try {
      const input = await openFind(ui);
      await inputValue(input, "Beta");
      await press(input, "Enter");
      if (method === "Escape") await press(input, "Escape");
      else await click(ui, "閉じる");
      assert.equal(ui.host.querySelector('input[type="search"]') === null, true);
      assert.deepEqual(matches(ui), ["1:1"]);
      const target = cell(ui, "1:1");
      assert.equal(document.activeElement === target, true);
      await press(target, "ArrowRight");
      assert.deepEqual(selected(ui), ["1:2"]);
      await press(cell(ui, "1:2"), "f", { ctrlKey: true });
      assert.equal(search(ui).value, "Beta");
      assert.deepEqual(matches(ui), ["1:1"]);
    } finally { await ui.cleanup(); }
  });
}

for (const context of ["table", "page", "transport", "allowMutations"]) {
  test(`MIG-0737 U01 Find: ${context} replacement clears query, highlights and previous selection`, async () => {
    const ui = await mount();
    try {
      const input = await openFind(ui);
      await inputValue(input, "Beta");
      await press(input, "Enter");
      const replacement = context === "table" ? { data: { ...data, def: { ...data.def, table: "events" } } }
        : context === "page" ? { data: { ...data, page: 3 } }
        : context === "transport" ? { fetchFn: async () => { throw Error("Find must not fetch replacement transport"); } }
        : { allowMutations: true };
      await ui.render(replacement);
      assert.equal(ui.host.querySelector('input[type="search"]') === null, true);
      assert.deepEqual(matches(ui), []);
      assert.deepEqual(selected(ui), ["0:0"]);
      assert.equal(document.activeElement === cell(ui, "0:0"), true);
      assert.equal((await openFind(ui)).value, "");
      assertNoFindEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 Find: same-page replacement keeps the open query and searches only latest rows", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    await ui.render({ data: { ...data, rows: [
      { id: "a1", title: "Beta replacement", note: "current" },
      { id: "b2", title: "Changed", note: "current" },
    ] } });
    assert.equal(search(ui) === input, true);
    assert.equal(input.value, "Beta");
    assert.deepEqual(matches(ui), ["0:1"]);
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["0:1"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: shrinking dimensions clamp the origin before excluding it", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui, "2:2");
    await inputValue(input, "Beta");
    await ui.render({ data: { ...data, columns: columns.slice(0, 2), rows: data.rows.slice(0, 2) } });
    assert.equal(search(ui).value, "Beta");
    await press(input, "Enter");
    assert.match(statusText(ui), /見つかりません/);
    await press(input, "Escape");
    assert.equal(document.activeElement === cell(ui, "1:1"), true);
    assert.deepEqual(selected(ui), ["1:1"]);
  } finally { await ui.cleanup(); }
});

for (const dimension of ["rows", "columns"]) {
  test(`MIG-0737 U01 Find: empty ${dimension} has a keyboard entry and close-focus fallback`, async () => {
    const ui = await mount({ data: { ...data, [dimension]: [] } });
    try {
      const table = ui.host.querySelector("table");
      assert.equal(table.tabIndex, 0);
      await React.act(async () => table.focus());
      assert.equal((await press(table, "f", { ctrlKey: true })).defaultPrevented, true);
      const input = search(ui);
      await inputValue(input, "Alpha");
      await press(input, "Enter");
      assert.match(statusText(ui), /見つかりません/);
      assert.deepEqual(matches(ui), []);
      await press(input, "Escape");
      assert.equal(document.activeElement === table, true);
      assert.deepEqual(selected(ui), []);
      assertNoFindEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 Find: an open search survives an empty same-page snapshot and later rows", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui, "2:2");
    await inputValue(input, "Beta");
    await ui.render({ data: { ...data, rows: [] } });
    assert.equal(search(ui) === input, true);
    assert.equal(input.value, "Beta");
    await press(input, "Enter");
    assert.match(statusText(ui), /見つかりません/);
    assert.deepEqual(selected(ui), []);
    await ui.render({ data });
    assert.equal(search(ui).value, "Beta");
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["1:1"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: active drafts fence search controls without save, discard or focus loss", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    await click(ui, "1行 title を編集");
    const editor = cell(ui, "0:1").querySelector('input[type="text"]');
    assert.ok(editor);
    await inputValue(editor, "Unsaved draft");
    assert.equal(input.disabled, true);
    assert.equal(button(ui, "次へ").disabled, true);
    assert.equal(button(ui, "閉じる").disabled, true);
    for (const target of [editor, cell(ui, "0:1")]) {
      assert.equal((await press(target, "f", { ctrlKey: true })).defaultPrevented, false);
    }
    await press(input, "Enter");
    await press(input, "Escape");
    assert.equal(search(ui) === input, true);
    assert.equal(editor.value, "Unsaved draft");
    assert.equal(document.activeElement === editor, true);
    assert.deepEqual(selected(ui), ["0:1"]);
    assertNoFindEffects(ui);
    await click(ui, "キャンセル");
    assert.equal(input.disabled, false);
    await click(ui, "次へ");
    assert.deepEqual(selected(ui), ["1:1"]);
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: a same-batch draft defeats previously enabled Next, Close and shortcut handlers", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    const next = button(ui, "次へ");
    const close = button(ui, "閉じる");
    const edit = button(ui, "1行 title を編集");
    const target = cell(ui, "0:1");
    const shortcut = keyEvent("f", { ctrlKey: true });
    await React.act(async () => {
      edit.click();
      next.click();
      close.click();
      target.dispatchEvent(shortcut);
    });
    const editor = target.querySelector('input[type="text"]');
    assert.ok(editor);
    assert.equal(editor.value, "Alpha");
    assert.equal(document.activeElement === editor, true);
    assert.equal(search(ui) === input, true);
    assert.equal(input.disabled, true);
    assert.equal(shortcut.defaultPrevented, false);
    assert.deepEqual(selected(ui), ["0:1"]);
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find: same-batch Undo fences stale controls until its own history operation ends", async () => {
  const pending = deferred();
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: async (_path, init) => { requests.push(init); return requests.length === 1 ? writeOk() : pending.promise; },
    onRefresh: () => { refreshes++; },
  });
  try {
    await click(ui, "1行 title を編集");
    await inputValue(cell(ui, "0:1").querySelector('input[type="text"]'), "Changed");
    await click(ui, "セルを保存");
    await flush();
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    const next = button(ui, "次へ");
    const close = button(ui, "閉じる");
    const undo = button(ui, "元に戻す");
    const shortcut = keyEvent("f", { metaKey: true });
    await React.act(async () => {
      undo.click();
      next.click();
      close.click();
      cell(ui, "0:0").dispatchEvent(shortcut);
    });
    assert.equal(requests.length, 2);
    assert.equal(shortcut.defaultPrevented, false);
    assert.equal(search(ui) === input, true);
    assert.equal(input.disabled, true);
    assert.equal(next.disabled, true);
    assert.equal(close.disabled, true);
    assert.deepEqual(selected(ui), ["0:0"]);
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["0:0"]);
    await React.act(async () => pending.resolve(writeOk()));
    await flush();
    assert.equal(input.disabled, false);
    await click(ui, "次へ");
    assert.deepEqual(selected(ui), ["1:1"]);
    assert.deepEqual(requests.map(init => JSON.parse(init.body).value), ["Changed", "Alpha"]);
    assert.equal(refreshes, 2);
  } finally { pending.resolve(writeOk()); await ui.cleanup(); }
});

test("MIG-0737 U01 Find: ordinary PATCH and post-write refresh allow navigation without extra writes", async () => {
  const patch = deferred();
  const refresh = deferred();
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    data: { ...data, rows: data.rows.map(row => ({ ...row, title: "hit " + row.title })) },
    fetchFn: async (_path, init) => { requests.push(init); return patch.promise; },
    onRefresh: () => { refreshes++; return refresh.promise; },
  });
  try {
    const input = await openFind(ui, "0:1");
    await inputValue(input, "hit");
    await click(ui, "1行 title を編集");
    await inputValue(cell(ui, "0:1").querySelector('input[type="text"]'), "changed title");
    await click(ui, "セルを保存");
    assert.equal(requests.length, 1);
    assert.equal(refreshes, 0);
    assert.equal(input.disabled, false);
    await click(ui, "次へ");
    assert.deepEqual(selected(ui), ["1:1"]);
    assert.equal(cell(ui, "0:1").textContent.includes("hit Alpha"), true, "Find reads displayed rows, not optimistic edits");
    await React.act(async () => patch.resolve(writeOk()));
    await flush();
    assert.equal(refreshes, 1);
    assert.equal(input.disabled, false);
    await click(ui, "次へ");
    assert.deepEqual(selected(ui), ["2:1"]);
    await React.act(async () => refresh.resolve());
    await flush();
    assert.deepEqual(selected(ui), ["2:1"]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "PATCH");
    assert.equal(refreshes, 1);
    assert.deepEqual(ui.effects.copied, []);
  } finally { patch.resolve(writeOk()); refresh.resolve(); await ui.cleanup(); }
});

test("MIG-0737 U01 Find: an ordinary pending DELETE keeps Find available without another confirmation", async () => {
  const pending = deferred();
  const requests = [];
  let confirmations = 0;
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    confirmDelete: () => { confirmations++; return true; },
    fetchFn: async (_path, init) => { requests.push(init); return pending.promise; },
    onRefresh: () => { refreshes++; },
  });
  try {
    await click(ui, "1行を削除");
    const input = await openFind(ui);
    await inputValue(input, "Beta");
    await press(input, "Enter");
    assert.deepEqual(selected(ui), ["1:1"]);
    assert.equal(input.disabled, false);
    assert.equal(confirmations, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "DELETE");
    assert.equal(refreshes, 0);
    await React.act(async () => pending.resolve(writeOk()));
    await flush();
    assert.equal(refreshes, 1);
    assert.deepEqual(selected(ui), ["1:1"]);
  } finally { pending.resolve(writeOk()); await ui.cleanup(); }
});

test("MIG-0737 U01 Find: its 3500ms hint expires without deleting a mutation receipt", async () => {
  const clock = hintClock();
  let writes = 0;
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: async () => { writes++; return writeOk(); },
    onRefresh: () => { refreshes++; },
  });
  try {
    await click(ui, "1行 title を編集");
    await inputValue(cell(ui, "0:1").querySelector('input[type="text"]'), "Changed");
    await click(ui, "セルを保存");
    await flush();
    assert.match(statusText(ui), /保存しました/);
    const input = await openFind(ui);
    await inputValue(input, "missing value");
    await press(input, "Enter");
    assert.match(statusText(ui), /見つかりません/);
    assert.match(statusText(ui), /保存しました/);
    await React.act(async () => clock.tick(3499));
    assert.match(statusText(ui), /見つかりません/);
    await React.act(async () => clock.tick(1));
    assert.doesNotMatch(statusText(ui), /見つかりません/);
    assert.match(statusText(ui), /保存しました/);
    assert.equal(writes, 1);
    assert.equal(refreshes, 1);
  } finally { await ui.cleanup(); clock.restore(); }
});

function gridTabEntries(ui) {
  const table = ui.host.querySelector("table");
  const cells = [...ui.host.querySelectorAll("[data-grid-cell]")]
    .filter(node => node.tabIndex === 0).map(node => node.dataset.gridCell);
  return table.tabIndex === 0 ? ["table", ...cells] : cells;
}

for (const scenario of [
  { name: "rows", next: { ...data, rows: data.rows.slice(0, 2) }, end: "1:2", modifiers: { ctrlKey: true } },
  { name: "columns", next: { ...data, columns: columns.slice(0, 2) }, end: "2:1", modifiers: { metaKey: true } },
  { name: "both dimensions", next: { ...data, rows: data.rows.slice(0, 2), columns: columns.slice(0, 2) }, end: "1:1", modifiers: { ctrlKey: true } },
]) {
  test(`MIG-0737 U01 Find shrink: closed Find restores keyboard access after ${scenario.name} remove the focused cell`, async () => {
    const ui = await mount();
    try {
      const input = await openFind(ui, "2:2");
      await inputValue(input, "Beta");
      await press(input, "Escape");
      const removed = cell(ui, "2:2");
      assert.equal(document.activeElement === removed, true);
      await ui.render({ data: scenario.next });
      assert.equal(removed.isConnected, false);
      assert.deepEqual(gridTabEntries(ui), [scenario.end], "render itself must restore one data-cell Tab entry");
      const target = cell(ui, scenario.end);
      assert.equal(document.activeElement === target, true, "detached focus must be rescued before another key");
      assert.equal(ui.host.querySelector('input[type="search"]') === null, true);
      assert.deepEqual(matches(ui), ["1:1"]);
      assert.equal((await press(document.activeElement, "f", scenario.modifiers)).defaultPrevented, true);
      assert.equal(search(ui).value, "Beta");
      assert.equal(document.activeElement === search(ui), true);
      assertNoFindEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

for (const dimension of ["rows", "columns"]) {
  test(`MIG-0737 U01 Find shrink: empty ${dimension} rescue removed-cell focus to the table and recover one cell entry`, async () => {
    const ui = await mount();
    try {
      const input = await openFind(ui, "2:2");
      await inputValue(input, "Beta");
      await press(input, "Escape");
      const removed = cell(ui, "2:2");
      const table = ui.host.querySelector("table");
      assert.equal(document.activeElement === removed, true);
      await ui.render({ data: { ...data, [dimension]: [] } });
      assert.equal(removed.isConnected, false);
      assert.deepEqual(gridTabEntries(ui), ["table"]);
      assert.equal(document.activeElement === table, true);
      assert.equal((await press(document.activeElement, "f", { metaKey: true })).defaultPrevented, true);
      assert.equal(search(ui).value, "Beta");
      await press(search(ui), "Escape");
      assert.equal(document.activeElement === table, true);
      await ui.render({ data });
      const entries = gridTabEntries(ui);
      assert.equal(entries.length, 1);
      assert.notEqual(entries[0], "table");
      assert.deepEqual(matches(ui), ["1:1"]);
      // JSDOM has no native Tab traversal; inspect the entry, then use the cell it exposes.
      const target = cell(ui, entries[0]);
      await React.act(async () => target.focus());
      assert.equal((await press(document.activeElement, "f", { ctrlKey: true })).defaultPrevented, true);
      assert.equal(search(ui).value, "Beta");
      assertNoFindEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

for (const owner of ["search input", "Next button", "editing toolbar"]) {
  test(`MIG-0737 U01 Find shrink: open Find preserves ${owner} focus while bounding the grid Tab entry`, async () => {
    const ui = await mount({ allowMutations: true });
    try {
      const input = await openFind(ui, "2:2");
      await inputValue(input, "Beta");
      const target = owner === "search input" ? input
        : owner === "Next button" ? button(ui, "次へ") : button(ui, "行を追加");
      await React.act(async () => target.focus());
      assert.equal(document.activeElement === target, true);
      const removed = cell(ui, "2:2");
      await ui.render({ data: { ...data, rows: data.rows.slice(0, 2), columns: columns.slice(0, 2) } });
      assert.equal(removed.isConnected, false);
      assert.deepEqual(gridTabEntries(ui), ["1:1"]);
      assert.equal(document.activeElement === target, true, "dimension repair must not steal external focus");
      assert.equal(search(ui) === input, true);
      assert.equal(input.value, "Beta");
      assert.deepEqual(matches(ui), ["1:1"]);
      assertNoFindEffects(ui);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 Find shrink: a cell deliberately blurred before replacement does not reclaim body focus", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui, "2:2");
    await inputValue(input, "Beta");
    await press(input, "Escape");
    const removed = cell(ui, "2:2");
    await React.act(async () => removed.blur());
    assert.equal(document.activeElement === document.body, true);
    await ui.render({ data: { ...data, rows: data.rows.slice(0, 2), columns: columns.slice(0, 2) } });
    assert.equal(removed.isConnected, false);
    assert.deepEqual(gridTabEntries(ui), ["1:1"]);
    assert.equal(document.activeElement === document.body, true, "body was focused before the cell was removed");
    assert.deepEqual(matches(ui), ["1:1"]);
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find shrink: unrelated dimension removal retains the live draft, snapshot and Find fence", async () => {
  const ui = await mount({ allowMutations: true });
  try {
    const input = await openFind(ui, "2:2");
    await inputValue(input, "Beta");
    await click(ui, "1行 title を編集");
    const editor = cell(ui, "0:1").querySelector('input[type="text"]');
    assert.ok(editor);
    await inputValue(editor, "Uncommitted original-row draft");
    await ui.render({ data: { ...data, rows: data.rows.slice(0, 2), columns: columns.slice(0, 2) } });
    assert.equal(cell(ui, "0:1").querySelector('input[type="text"]') === editor, true);
    assert.equal(editor.value, "Uncommitted original-row draft");
    assert.equal(document.activeElement === editor, true);
    assert.deepEqual(gridTabEntries(ui), ["0:1"]);
    assert.equal(search(ui) === input, true);
    assert.equal(input.value, "Beta");
    assert.equal(input.disabled, true);
    assert.equal(button(ui, "次へ").disabled, true);
    assert.equal(button(ui, "閉じる").disabled, true);
    assert.equal(button(ui, "セルを保存").disabled, false, "unchanged original target must retain its eligible draft");
    await press(input, "Enter");
    assert.equal((await press(cell(ui, "0:1"), "f", { ctrlKey: true })).defaultPrevented, false);
    assert.equal(document.activeElement === editor, true);
    assert.deepEqual(selected(ui), ["0:1"]);
    assert.deepEqual(matches(ui), ["1:1"]);
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find shrink: pending Undo retains its guard and history while removed grid focus is repaired", async () => {
  const pending = deferred();
  const requests = [];
  let refreshes = 0;
  const ui = await mount({ allowMutations: true,
    fetchFn: async (_path, init) => { requests.push(init); return requests.length === 1 ? writeOk() : pending.promise; },
    onRefresh: () => { refreshes++; },
  });
  try {
    await click(ui, "1行 title を編集");
    await inputValue(cell(ui, "0:1").querySelector('input[type="text"]'), "Changed");
    await click(ui, "セルを保存");
    await flush();
    assert.match(statusText(ui), /保存しました/);
    const input = await openFind(ui, "2:2");
    await inputValue(input, "Beta");
    await press(input, "Escape");
    const removed = cell(ui, "2:2");
    await press(removed, "z", { ctrlKey: true });
    assert.equal(requests.length, 2);
    assert.equal(refreshes, 1);
    assert.equal(document.activeElement === removed, true);
    await ui.render({ data: { ...data, rows: data.rows.slice(0, 2), columns: columns.slice(0, 2) } });
    assert.equal(removed.isConnected, false);
    assert.deepEqual(gridTabEntries(ui), ["1:1"]);
    const target = cell(ui, "1:1");
    assert.equal(document.activeElement === target, true);
    assert.equal((await press(target, "f", { ctrlKey: true })).defaultPrevented, false);
    assert.equal(ui.host.querySelector('input[type="search"]') === null, true);
    assert.deepEqual(matches(ui), ["1:1"]);
    assert.equal(requests.length, 2);
    await React.act(async () => pending.resolve(writeOk()));
    await flush();
    assert.match(statusText(ui), /保存しました/);
    assert.equal(button(ui, "やり直す").disabled, false, "dimension repair must preserve the completed Undo history");
    assert.equal((await press(target, "f", { metaKey: true })).defaultPrevented, true);
    assert.equal(search(ui).value, "Beta");
    assert.deepEqual(requests.map(init => JSON.parse(init.body).value), ["Changed", "Alpha"]);
    assert.equal(refreshes, 2);
    assert.deepEqual(ui.effects.copied, []);
  } finally { pending.resolve(writeOk()); await ui.cleanup(); }
});

test("MIG-0737 U01 Find shrink: a same-count column-key replacement rescues the detached focused cell", async () => {
  const ui = await mount();
  try {
    const input = await openFind(ui, "2:2");
    await inputValue(input, "Beta");
    await press(input, "Escape");
    const removed = cell(ui, "2:2");
    assert.equal(document.activeElement === removed, true);
    await ui.render({ data: {
      ...data,
      columns: [columns[0], columns[1], { ...columns[2], name: "description" }],
      rows: data.rows.map(row => ({ ...row, description: row.note })),
    } });
    assert.equal(removed.isConnected, false);
    assert.deepEqual(gridTabEntries(ui), ["2:2"]);
    const replacement = cell(ui, "2:2");
    assert.equal(document.activeElement === replacement, true);
    assert.deepEqual(matches(ui), ["1:1"]);
    assert.equal((await press(document.activeElement, "f", { ctrlKey: true })).defaultPrevented, true);
    assert.equal(search(ui).value, "Beta");
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 Find shrink: external focus followed by body focus cannot revive a stale removed-cell target", async () => {
  const ui = await mount();
  const external = document.createElement("button");
  external.textContent = "External control";
  document.body.append(external);
  try {
    const input = await openFind(ui, "2:2");
    await inputValue(input, "Beta");
    await press(input, "Escape");
    const removed = cell(ui, "2:2");
    await React.act(async () => external.focus());
    assert.equal(document.activeElement === external, true);
    const shrunk = { ...data, rows: data.rows.slice(0, 2), columns: columns.slice(0, 2) };
    await ui.render({ data: shrunk });
    assert.equal(removed.isConnected, false);
    assert.equal(document.activeElement === external, true);
    assert.deepEqual(gridTabEntries(ui), ["1:1"]);
    await React.act(async () => external.blur());
    assert.equal(document.activeElement === document.body, true);
    await ui.render({ data: { ...shrunk, rows: shrunk.rows.map(row => ({ ...row })) } });
    assert.equal(document.activeElement === document.body, true, "a consumed removal must never steal focus later");
    assert.deepEqual(gridTabEntries(ui), ["1:1"]);
    assert.deepEqual(matches(ui), ["1:1"]);
    assertNoFindEffects(ui);
  } finally { await ui.cleanup(); external.remove(); }
});

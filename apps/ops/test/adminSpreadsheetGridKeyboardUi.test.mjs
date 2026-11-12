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
  await React.act(async () => root.render(React.createElement(AdminSpreadsheetEditableGrid, {
    data, onRefresh: () => {}, fetchFn: async () => { throw Error("unexpected mutation"); },
    ...props,
  })));
  return { host, cleanup: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}
async function press(cell, key, options = {}) {
  await React.act(async () => {
    cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key, bubbles: true, cancelable: true, ...options,
    }));
  });
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

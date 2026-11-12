import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { JSDOM } from "jsdom";
import { AdminSpreadsheetReadView } from "../.test-dist/apps/ops/src/routes/admin/AdminSpreadsheetReadView.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/spreadsheet",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const tables = [
  { table: "videos", label: "動画", group: "コンテンツ", mode: "editable" },
  { table: "events", label: "イベント", group: "コンテンツ", mode: "readonly" },
];
const catalog = { tables, groups: { コンテンツ: tables },
  pageSize: 50, discoveredAt: "2026-10-30T00:00:00.000Z" };
function page(table, title = "before") {
  return {
    def: tables.find(t => t.table === table),
    columns: [
      { name: "id", type: "TEXT", editable: false, pk: 1, notNull: true },
      { name: "title", type: "TEXT", editable: true, pk: 0, notNull: false },
    ],
    primaryKeys: ["id"], rows: [{ id: "v1", title }],
    hasMore: false, page: 1, limit: 50,
  };
}
async function flush() {
  await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
}
async function mount(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(AdminSpreadsheetReadView, props)));
  await flush(); await flush();
  return {
    host,
    cleanup: async () => { await React.act(async () => root.unmount()); host.remove(); },
  };
}
async function click(ui, name) {
  const b = [...ui.host.querySelectorAll("button")].find(el =>
    el.getAttribute("aria-label") === name || el.textContent.trim() === name);
  assert.ok(b, "button not found: " + name);
  assert.equal(b.disabled, false, "button disabled: " + name);
  await React.act(async () => b.click());
  await flush();
}

test("MIG-0737 U01: read explorer keeps writes disabled by default", async () => {
  const paths = [];
  const fn = async (path, init) => {
    paths.push({ path, method: init.method });
    return path.includes("/tables") ? json(200, catalog) : json(200, page("videos"));
  };
  const ui = await mount({ fetchFn: fn, initialTable: "videos" });
  try {
    assert.equal(ui.host.querySelectorAll('button[aria-label="1行 title を編集"]').length, 0);
    assert.equal(ui.host.querySelectorAll("input").length, 0);
    assert.match(ui.host.textContent, /読み取り専用/);
    assert.ok(paths.every(x => x.method === "GET"));
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: opt-in edit calls PATCH then refreshes row from RH-003, never optimistic-writes", async () => {
  let title = "before";
  const requests = [];
  const fn = async (path, init) => {
    requests.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (path.includes("/tables")) return json(200, catalog);
    if (init.method === "PATCH") {
      title = JSON.parse(init.body).value;
      return json(200, { ok: true });
    }
    return json(200, page("videos", title));
  };
  const ui = await mount({ fetchFn: fn, initialTable: "videos", enableMutations: true });
  try {
    await click(ui, "1行 title を編集");
    const input = ui.host.querySelector("label input[type=text]");
    assert.ok(input);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await React.act(async () => {
      setter.call(input, "after");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await click(ui, "セルを保存");
    assert.match(ui.host.textContent, /after/);
    assert.equal(requests.filter(x => x.method === "PATCH").length, 1);
    assert.deepEqual(requests.find(x => x.method === "PATCH").body,
      { table: "videos", primaryKey: { id: "v1" }, column: "title", value: "after" });
    const patchIndex = requests.findIndex(x => x.method === "PATCH");
    assert.equal(requests[patchIndex + 1].method, "GET");
    assert.equal(requests[patchIndex + 1].path, "/api/admin/spreadsheet/data?table=videos&page=1");
    await click(ui, "元に戻す");
    assert.match(ui.host.textContent, /before/);
    assert.deepEqual(requests.filter(x => x.method === "PATCH").map(x => x.body.value),
      ["after", "before"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: readonly table cannot opt in to mutation UI", async () => {
  const fn = async (path) => path.includes("/tables")
    ? json(200, catalog) : json(200, page("events"));
  const ui = await mount({ fetchFn: fn, initialTable: "events", enableMutations: true });
  try {
    assert.match(ui.host.textContent, /読み取り専用（編集は無効/);
    assert.equal(ui.host.querySelectorAll('button[aria-label="1行 title を編集"]').length, 0);
    assert.equal(ui.host.querySelector('button[aria-label="1行を削除"]').disabled, true);
  } finally { await ui.cleanup(); }
});

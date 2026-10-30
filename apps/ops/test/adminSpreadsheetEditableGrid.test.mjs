import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const columns = [
  { name: "id", type: "TEXT", editable: false, pk: 1, notNull: true },
  { name: "title", type: "TEXT", editable: true, pk: 0, notNull: false },
  { name: "secret", type: "TEXT", editable: false, pk: 0, notNull: false },
];
function fixture(table = "videos", mode = "editable", currentPage = 1, rows = [{ id: "v1", title: "<unsafe>", secret: "••••" }]) {
  return {
    def: { table, label: table, group: "content", mode },
    columns, rows, primaryKeys: ["id"], page: currentPage, limit: 50, hasMore: false,
  };
}
async function flush() {
  await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
}
async function mount(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const draw = async (next) => {
    await React.act(async () => root.render(React.createElement(AdminSpreadsheetEditableGrid, next)));
    await flush();
  };
  await draw(props);
  return { host, render: draw, cleanup: async () => {
    await React.act(async () => root.unmount()); host.remove();
  } };
}
async function click(ui, label) {
  const b = [...ui.host.querySelectorAll("button")].find(x =>
    x.getAttribute("aria-label") === label || x.textContent.trim() === label);
  assert.ok(b, "button missing: " + label);
  assert.equal(b.disabled, false, "button disabled: " + label);
  await React.act(async () => b.click());
  await flush();
}
async function input(ui, label, value) {
  const target = [...ui.host.querySelectorAll("label")].find(x => x.textContent.includes(label))
    ?.querySelector("input");
  assert.ok(target, "input missing: " + label);
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  await React.act(async () => {
    setValue.call(target, value);
    target.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("MIG-0737 U01: SSR defaults to no mutations and escapes untrusted grid rows", () => {
  const html = renderToStaticMarkup(React.createElement(AdminSpreadsheetEditableGrid, {
    data: fixture(), onRefresh: () => {}, fetchFn: async () => json(200, { ok: true }),
  }));
  assert.match(html, /読み取り専用/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.doesNotMatch(html, /aria-label="1行 title を編集"/);
});

test("MIG-0737 U01: editable title PATCH, Undo and Redo preserve PK and values", async () => {
  const sent = [];
  let title = "<unsafe>";
  let refresh = 0;
  let ui;
  const fetchFn = async (_, init) => {
    sent.push({ method: init.method, body: JSON.parse(init.body) });
    title = JSON.parse(init.body).value;
    return json(200, { ok: true, pendingPublicReflection: true });
  };
  // The integrated read-view test owns RH-003 reload. Keep this unit test focused on
  // the history transport; nesting React.act() within onRefresh corrupts subsequent tests.
  const props = { data: fixture("videos", "editable", 1, [{ id: "v1", title, secret: "••••" }]),
    fetchFn, allowMutations: true, onRefresh: () => { refresh++; } };
  ui = await mount(props);
  try {
    assert.equal(ui.host.querySelectorAll('button[aria-label="1行 id を編集"]').length, 0);
    assert.equal(ui.host.querySelectorAll('button[aria-label="1行 secret を編集"]').length, 0);
    await click(ui, "1行 title を編集");
    await input(ui, "title を編集", "new title");
    await click(ui, "セルを保存");
    assert.equal(title, "new title");
    assert.equal(refresh, 1);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { method: "PATCH", body: {
      table: "videos", primaryKey: { id: "v1" }, column: "title", value: "new title",
    } });
    assert.match(ui.host.textContent, /公開ページへの反映は再生成後/);
    await click(ui, "元に戻す");
    assert.equal(title, "<unsafe>");
    await click(ui, "やり直す");
    assert.equal(title, "new title");
    assert.deepEqual(sent.map(x => x.body.value), ["new title", "<unsafe>", "new title"]);
    assert.equal(refresh, 3);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: row insert requires PK, never includes readonly secret column", async () => {
  const requests = [];
  const fetchFn = async (_, init) => {
    requests.push({ method: init.method, body: JSON.parse(init.body) });
    return json(200, { ok: true });
  };
  let refresh = 0;
  const ui = await mount({ data: fixture(), fetchFn, allowMutations: true, onRefresh: () => { refresh++; } });
  try {
    await click(ui, "行を追加");
    assert.equal(ui.host.querySelectorAll('[aria-label="新規行フォーム"] input').length, 2);
    await input(ui, "title", "New row");
    await click(ui, "追加を保存");
    assert.equal(requests.length, 0);
    assert.match(ui.host.textContent, /主キーを入力/);
    await input(ui, "id", "v2");
    await click(ui, "追加を保存");
    assert.equal(refresh, 1);
    assert.deepEqual(requests, [{ method: "POST", body: {
      table: "videos", row: { id: "v2", title: "New row" },
    } }]);
    assert.equal(ui.host.querySelectorAll('[aria-label="新規行フォーム"]').length, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: DELETE requires explicit confirmation, no retry, clears undo", async () => {
  let confirmed = false;
  let calls = 0;
  let prompts = 0;
  const fetchFn = async (_, init) => {
    calls++;
    assert.equal(init.method, "DELETE");
    assert.deepEqual(JSON.parse(init.body), { table: "videos", primaryKey: { id: "v1" } });
    throw Error("offline");
  };
  const ui = await mount({ data: fixture(), fetchFn, allowMutations: true,
    onRefresh: () => {}, confirmDelete: () => { prompts++; return confirmed; },
  });
  try {
    await click(ui, "1行を削除");
    assert.equal(prompts, 1);
    assert.equal(calls, 0);
    confirmed = true;
    await click(ui, "1行を削除");
    assert.equal(prompts, 2);
    assert.equal(calls, 1);
    assert.match(ui.host.textContent, /保存できませんでした/);
    assert.equal([...ui.host.querySelectorAll("button")].find(x => x.textContent === "元に戻す").disabled, true);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: read-only, missing PK and globally disabled edits issue no mutations", async () => {
  let calls = 0;
  const fn = async () => { calls++; return json(200, { ok: true }); };
  for (const [data, allowMutations] of [
    [fixture("videos", "readonly"), true],
    [fixture(), false],
    [fixture("videos", "editable", 1, [{ title: "missing" }]), true],
  ]) {
    const ui = await mount({ data, fetchFn: fn, allowMutations, onRefresh: () => {} });
    try {
      assert.equal(ui.host.querySelectorAll('button[aria-label="1行 title を編集"]').length, 0);
      assert.equal(ui.host.querySelector('button[aria-label="1行を削除"]').disabled, true);
      assert.equal(ui.host.querySelectorAll("input").length, 0);
    } finally { await ui.cleanup(); }
  }
  assert.equal(calls, 0);
});

test("MIG-0737 U01: changing table/page/transport immediately fences previous undo and pending edit", async () => {
  const fn = async () => json(200, { ok: true });
  const ui = await mount({ data: fixture(), fetchFn: fn, allowMutations: true, onRefresh: () => {} });
  try {
    await click(ui, "1行 title を編集");
    assert.equal(ui.host.querySelectorAll("input").length, 1);
    await ui.render({ data: fixture("events"), fetchFn: fn, allowMutations: true, onRefresh: () => {} });
    assert.equal(ui.host.querySelectorAll("input").length, 0);
    assert.equal([...ui.host.querySelectorAll("button")].find(x => x.textContent === "元に戻す").disabled, true);
    await ui.render({ data: fixture("events", "editable", 2), fetchFn: fn,
      allowMutations: true, onRefresh: () => {} });
    assert.equal(ui.host.querySelectorAll("input").length, 0);
  } finally { await ui.cleanup(); }
});

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

test("MIG-0737 U01: a changed same-page edit snapshot cannot retarget or revive a draft", async () => {
  const rows = [{ id: "v1", title: "original", secret: "••••" }, { id: "v2", title: "other" }];
  const original = fixture("videos", "editable", 1, rows);
  const composite = {
    ...original,
    columns: [...columns, { name: "part", type: "TEXT", editable: false, pk: 2, notNull: true }],
    primaryKeys: ["id", "part"],
    rows: rows.map(row => ({ ...row, part: "a" })),
  };
  const cases = [
    ["reordered", original, { ...original, rows: [...rows].reverse() }],
    ["removed", original, { ...original, rows: [rows[1]] }],
    ["replacement", original, { ...original, rows: [{ ...rows[0], id: "v3" }, rows[1]] }],
    ["original value changed", original, { ...original, rows: [{ ...rows[0], title: "new server value" }, rows[1]] }],
    ["column no longer editable", original, { ...original, columns: columns.map(c => c.name === "title" ? { ...c, editable: false } : c) }],
    ["column now generated", original, { ...original, columns: columns.map(c => c.name === "title" ? { ...c, generated: true } : c) }],
    ["table readonly", original, { ...original, def: { ...original.def, mode: "readonly" } }],
    ["composite part replaced", composite, { ...composite, rows: [{ ...composite.rows[0], part: "b" }, composite.rows[1]] }],
    ["composite part missing", composite, { ...composite, rows: [{ ...composite.rows[0], part: null }, composite.rows[1]] }],
    ["primary key schema changed", composite, { ...composite, primaryKeys: ["id"] }],
  ];
  for (const [label, initial, changed] of cases) {
    const sent = [];
    let refreshes = 0;
    const props = { data: initial, allowMutations: true, onRefresh: () => { refreshes++; },
      fetchFn: async (_, init) => { sent.push(JSON.parse(init.body)); return json(200, { ok: true }); } };
    const ui = await mount(props);
    try {
      await click(ui, "1行 title を編集");
      await input(ui, "title を編集", "draft");
      await ui.render({ ...props, data: changed });
      assert.match(ui.host.querySelector('[role="alert"]')?.textContent ?? "", /状態が変更されました/, label);
      assert.equal(ui.host.querySelectorAll('input').length, 0, label + " must not display draft on replacement row");
      assert.equal([...ui.host.querySelectorAll('button')].some(b => b.textContent === "セルを保存"), false, label);
      assert.equal(sent.length, 0, label);
      assert.equal(refreshes, 0, label);
      await ui.render(props);
      assert.ok(ui.host.querySelector('[role="alert"]'), label + " must remain invalidated");
      assert.equal(ui.host.querySelectorAll('input').length, 0, label);
      assert.equal(ui.host.querySelector('button[aria-label="1行 title を編集"]').disabled, true, label);
      assert.equal([...ui.host.querySelectorAll('button')].find(b => b.textContent === "元に戻す").disabled, true);
      await click(ui, "編集を破棄");
      assert.equal(ui.host.querySelector('[role="alert"]'), null);
      await click(ui, "1行 title を編集");
      await input(ui, "title を編集", "fresh");
      await click(ui, "セルを保存");
      assert.deepEqual(sent, [{ table: "videos", primaryKey: initial.primaryKeys.length === 2
        ? { id: "v1", part: "a" } : { id: "v1" }, column: "title", value: "fresh" }], label);
      assert.equal(refreshes, 1);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01: keyboard edit retains original PK and value through unchanged target refresh", async () => {
  const original = fixture("videos", "editable", 1, [{ id: "v1", title: "before", secret: "masked" }]);
  const sent = [];
  const props = { data: original, allowMutations: true, onRefresh: () => {},
    fetchFn: async (_, init) => { sent.push(JSON.parse(init.body)); return json(200, { ok: true }); } };
  const ui = await mount(props);
  try {
    const cell = ui.host.querySelector('[data-grid-cell="0:1"]');
    assert.ok(cell);
    await React.act(async () => {
      cell.focus();
      cell.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();
    await input(ui, "title を編集", "draft");
    await ui.render({ ...props, data: { ...original, rows: [{ ...original.rows[0], secret: "updated unrelated value" }] } });
    assert.equal(ui.host.querySelector('[role="alert"]'), null);
    assert.equal(ui.host.querySelector('input').value, "draft");
    await click(ui, "セルを保存");
    await click(ui, "元に戻す");
    assert.deepEqual(sent, [
      { table: "videos", primaryKey: { id: "v1" }, column: "title", value: "draft" },
      { table: "videos", primaryKey: { id: "v1" }, column: "title", value: "before" },
    ]);
  } finally { await ui.cleanup(); }
});


const editorRows = [
  { id: "v1", title: "Alpha", secret: "first" },
  { id: "v2", title: "Beta", secret: "second" },
];
const editorData = () => fixture("videos", "editable", 1, editorRows);
const saveResponse = () => json(200, { ok: true });
function namedButton(ui, name) {
  const button = [...ui.host.querySelectorAll("button")].find(el =>
    el.getAttribute("aria-label") === name || el.textContent.trim() === name);
  assert.ok(button, "missing button: " + name);
  return button;
}
function editedInput(ui) {
  const target = ui.host.querySelector('[data-grid-cell] input');
  assert.ok(target, "missing cell editor");
  return target;
}
function editorKey(target, key, options = {}) {
  return target.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key, bubbles: true, cancelable: true, ...options,
  }));
}
async function openDraft(ui, value, row = 1) {
  await click(ui, `${row}行 title を編集`);
  await input(ui, "title を編集", value);
  return editedInput(ui);
}
function selectedCoordinates(ui) {
  return [...ui.host.querySelectorAll('[data-grid-cell][aria-selected="true"]')]
    .map(cell => cell.dataset.gridCell);
}

for (const scenario of [
  { name: "Enter down", key: "Enter", row: 1, end: "1:1" },
  { name: "Enter at last row", key: "Enter", row: 2, end: "1:1" },
  { name: "Tab right", key: "Tab", row: 1, end: "0:2" },
  { name: "Shift+Tab left", key: "Tab", shiftKey: true, row: 1, end: "0:0" },
  { name: "Tab at last column", key: "Tab", row: 1, end: "0:1", columns: columns.slice(0, 2) },
  { name: "Shift+Tab at first column", key: "Tab", shiftKey: true, row: 1, end: "0:0",
    columns: [columns[1], columns[0], columns[2]] },
]) {
  test(`MIG-0737 U01 editor: ${scenario.name} closes before PATCH completes and clamps focus`, async () => {
    const pending = [];
    let refreshes = 0;
    const ui = await mount({ data: { ...editorData(), columns: scenario.columns ?? columns },
      allowMutations: true, onRefresh: () => { refreshes++; },
      fetchFn: (_, init) => new Promise(resolve => pending.push({ init, resolve })),
    });
    try {
      const target = await openDraft(ui, "Changed", scenario.row);
      assert.equal(document.activeElement === target, true);
      await React.act(async () => assert.equal(editorKey(target, scenario.key,
        { shiftKey: scenario.shiftKey ?? false }), false));
      assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
      assert.equal(document.activeElement?.getAttribute("data-grid-cell"), scenario.end);
      assert.deepEqual(selectedCoordinates(ui), [scenario.end]);
      assert.equal(pending.length, 1);
      assert.deepEqual(JSON.parse(pending[0].init.body), {
        table: "videos", primaryKey: { id: `v${scenario.row}` }, column: "title", value: "Changed",
      });
      assert.equal(refreshes, 0);
      await React.act(async () => pending[0].resolve(saveResponse()));
      await flush();
      assert.equal(refreshes, 1);
      assert.equal(namedButton(ui, "元に戻す").disabled, false);
    } finally { await ui.cleanup(); }
  });
}

test("MIG-0737 U01 editor: explicit Save closes immediately without optimistic row replacement", async () => {
  let finish;
  const requests = [];
  const ui = await mount({ data: editorData(), allowMutations: true, onRefresh: () => {},
    fetchFn: (_, init) => { requests.push(init); return new Promise(resolve => { finish = resolve; }); },
  });
  try {
    await openDraft(ui, "Changed");
    await click(ui, "セルを保存");
    assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
    assert.match(ui.host.querySelector('[data-grid-cell="0:1"]').textContent, /Alpha/);
    assert.equal(document.activeElement?.getAttribute("data-grid-cell"), "0:1");
    assert.equal(namedButton(ui, "1行 title を編集").disabled, true);
    assert.equal(requests.length, 1);
    await React.act(async () => finish(saveResponse()));
    await flush();
  } finally { await ui.cleanup(); }
});

for (const [typed, expected] of [["", null], [" \t ", null], [" null ", null], ["NuLl", null],
  ["  text  ", "  text  "], ["42", "42"], ['{"x":1}', '{"x":1}']]) {
  test(`MIG-0737 U01 editor: explicit commit preserves CURRENT normalization for ${JSON.stringify(typed)}`, async () => {
    const requests = [];
    const ui = await mount({ data: editorData(), allowMutations: true, onRefresh: () => {},
      fetchFn: async (_, init) => { requests.push(JSON.parse(init.body)); return saveResponse(); },
    });
    try {
      await openDraft(ui, typed);
      await click(ui, "セルを保存");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].value, expected);
      await click(ui, "元に戻す");
      assert.equal(requests[1].value, "Alpha");
    } finally { await ui.cleanup(); }
  });
}

for (const [name, original, typed] of [["text", "Alpha", "Alpha"], ["null", null, ""],
  ["undefined", undefined, " NULL "], ["empty display", "", " \t "]]) {
  test(`MIG-0737 U01 editor: ${name} no-op closes and moves without PATCH, refresh or history`, async () => {
    let calls = 0;
    let refreshes = 0;
    const ui = await mount({ data: fixture("videos", "editable", 1,
      [{ ...editorRows[0], title: original }, editorRows[1]]), allowMutations: true,
      fetchFn: async () => { calls++; return saveResponse(); }, onRefresh: () => { refreshes++; },
    });
    try {
      const target = await openDraft(ui, typed);
      await React.act(async () => editorKey(target, "Enter"));
      assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
      assert.equal(document.activeElement?.getAttribute("data-grid-cell"), "1:1");
      assert.deepEqual(selectedCoordinates(ui), ["1:1"]);
      assert.equal(calls, 0);
      assert.equal(refreshes, 0);
      assert.equal(namedButton(ui, "元に戻す").disabled, true);
      assert.equal(ui.host.querySelector('[role="status"]') === null, true);
    } finally { await ui.cleanup(); }
  });
}


test("MIG-0737 U01 editor: same-turn input, key and Save consume the latest draft exactly once", async () => {
  const requests = [];
  let finish;
  const ui = await mount({ data: editorData(), allowMutations: true, onRefresh: () => {},
    fetchFn: (_, init) => { requests.push(JSON.parse(init.body)); return new Promise(resolve => { finish = resolve; }); },
  });
  try {
    await click(ui, "1行 title を編集");
    const target = editedInput(ui);
    const save = namedButton(ui, "セルを保存");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(target, "Latest draft");
      target.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      editorKey(target, "Enter");
      save.click();
      save.click();
    });
    assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
    assert.deepEqual(requests.map(request => request.value), ["Latest draft"]);
    await React.act(async () => finish(saveResponse()));
    await flush();
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 editor: cancelled drafts cannot be revived by a stale same-turn Save", async () => {
  let calls = 0;
  const ui = await mount({ data: editorData(), allowMutations: true, onRefresh: () => {},
    fetchFn: async () => { calls++; return saveResponse(); },
  });
  try {
    await openDraft(ui, "Discarded");
    const save = namedButton(ui, "セルを保存");
    const cancel = namedButton(ui, "キャンセル");
    await React.act(async () => { cancel.click(); save.click(); });
    assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
    assert.equal(calls, 0);
    assert.equal(namedButton(ui, "元に戻す").disabled, true);
  } finally { await ui.cleanup(); }
});

for (const outsideFocus of [false, true]) {
  test(`MIG-0737 U01 editor: failed commit reselects its cell with external focus=${outsideFocus}`, async () => {
    let finish;
    let refreshes = 0;
    const outside = document.createElement("input"); document.body.append(outside);
    const ui = await mount({ data: editorData(), allowMutations: true,
      onRefresh: () => { refreshes++; }, fetchFn: () => new Promise(resolve => { finish = resolve; }),
    });
    try {
      const target = await openDraft(ui, "Rejected");
      await React.act(async () => editorKey(target, "Enter"));
      if (outsideFocus) outside.focus();
      await React.act(async () => finish(json(500, { ok: false })));
      await flush();
      assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
      assert.deepEqual(selectedCoordinates(ui), ["0:1"]);
      assert.equal(document.activeElement === (outsideFocus ? outside : ui.host.querySelector('[data-grid-cell="0:1"]')), true);
      assert.match(ui.host.textContent, /保存できませんでした/);
      assert.equal(namedButton(ui, "元に戻す").disabled, true);
      assert.equal(refreshes, 0);
    } finally { outside.remove(); await ui.cleanup(); }
  });
}

test("MIG-0737 U01 editor: successful PATCH with failed refresh remains saved and undoable without retry", async () => {
  const requests = [];
  const ui = await mount({ data: editorData(), allowMutations: true,
    fetchFn: async (_, init) => { requests.push(JSON.parse(init.body)); return saveResponse(); },
    onRefresh: async () => { throw Error("refresh unavailable"); },
  });
  try {
    await openDraft(ui, "Saved");
    await click(ui, "セルを保存");
    assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
    assert.match(ui.host.textContent, /保存済みですが、再取得できませんでした/);
    assert.equal(requests.length, 1);
    assert.equal(namedButton(ui, "元に戻す").disabled, false);
    await click(ui, "元に戻す");
    assert.deepEqual(requests.map(request => request.value), ["Saved", "Alpha"]);
  } finally { await ui.cleanup(); }
});

for (const context of ["transport", "page", "round-trip"]) {
  for (const outcome of ["resolve", "reject"]) {
    test(`MIG-0737 U01 editor: stale refresh ${outcome} preserves a new ${context} draft`, async () => {
      let settle;
      const oldRefresh = new Promise((resolve, reject) => { settle = outcome === "resolve" ? resolve : reject; });
      const oldRequests = [];
      let newCalls = 0;
      const props = { data: editorData(), allowMutations: true,
        fetchFn: async (_, init) => { oldRequests.push(JSON.parse(init.body)); return saveResponse(); },
        onRefresh: () => oldRefresh,
      };
      const ui = await mount(props);
      try {
        await openDraft(ui, "Old saved value");
        await click(ui, "セルを保存");
        assert.equal(oldRequests.length, 1);
        const next = { ...props, onRefresh: () => {} };
        if (context === "transport" || context === "round-trip") next.fetchFn = async () => { newCalls++; return saveResponse(); };
        else next.data = { ...editorData(), page: 2 };
        await ui.render(next);
        if (context === "round-trip") await ui.render({ ...props, onRefresh: () => {} });
        const fresh = await openDraft(ui, "New unsaved value");
        await React.act(async () => settle(outcome === "reject" ? Error("old refresh failed") : undefined));
        await flush();
        assert.equal(ui.host.querySelector('[data-grid-cell] input') === fresh, true);
        assert.equal(fresh.value, "New unsaved value");
        assert.equal(document.activeElement === fresh, true);
        assert.equal(namedButton(ui, "セルを保存").disabled, false);
        assert.equal(namedButton(ui, "元に戻す").disabled, true);
        assert.equal(ui.host.querySelector('[role="status"]') === null, true);
        assert.equal(oldRequests.length, 1);
        assert.equal(newCalls, 0);
      } finally { await ui.cleanup(); }
    });
  }
}

test("MIG-0737 U01 editor: stale PATCH cannot refresh or clear a replacement transport's draft", async () => {
  let finish;
  let oldRefreshes = 0;
  let oldSignal;
  const props = { data: editorData(), allowMutations: true,
    fetchFn: (_, init) => { oldSignal = init.signal; return new Promise(resolve => { finish = resolve; }); },
    onRefresh: () => { oldRefreshes++; },
  };
  const ui = await mount(props);
  try {
    await openDraft(ui, "Old write");
    await click(ui, "セルを保存");
    await ui.render({ ...props, fetchFn: async () => saveResponse(), onRefresh: () => {} });
    const fresh = await openDraft(ui, "Fresh draft");
    assert.equal(oldSignal.aborted, true);
    await React.act(async () => finish(saveResponse()));
    await flush();
    assert.equal(ui.host.querySelector('[data-grid-cell] input') === fresh, true);
    assert.equal(fresh.value, "Fresh draft");
    assert.equal(oldRefreshes, 0);
  } finally { await ui.cleanup(); }
});


test("MIG-0737 U01 editor: Escape keeps keyboard cancellation reachable without committing", async () => {
  let calls = 0;
  const ui = await mount({ data: editorData(), allowMutations: true, onRefresh: () => {},
    fetchFn: async () => { calls++; return saveResponse(); },
  });
  try {
    const target = await openDraft(ui, "Discarded by keyboard");
    assert.equal(document.activeElement === target, true);
    await React.act(async () => assert.equal(editorKey(target, "Escape"), false));
    assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
    assert.equal(document.activeElement?.getAttribute("data-grid-cell"), "0:1");
    assert.equal(calls, 0);
    assert.equal(namedButton(ui, "元に戻す").disabled, true);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 editor: an empty original display records CURRENT null for undo", async () => {
  const requests = [];
  const ui = await mount({ data: fixture("videos", "editable", 1, [{ ...editorRows[0], title: "" }]),
    allowMutations: true, onRefresh: () => {},
    fetchFn: async (_, init) => { requests.push(JSON.parse(init.body)); return saveResponse(); },
  });
  try {
    await openDraft(ui, "New value");
    await click(ui, "セルを保存");
    await click(ui, "元に戻す");
    assert.deepEqual(requests.map(request => request.value), ["New value", null]);
  } finally { await ui.cleanup(); }
});


for (const scenario of [
  { name: "reordered row and column", row: 1,
    next: { ...editorData(), rows: [...editorRows].reverse(), columns: [columns[1], columns[0], columns[2]] }, end: "1:0" },
  { name: "removed last row", row: 2, next: { ...editorData(), rows: [editorRows[0]] }, end: "0:1" },
  { name: "removed column", row: 1, next: { ...editorData(), columns: [columns[0], columns[2]] }, end: "0:1" },
  { name: "empty page", row: 1, next: { ...editorData(), rows: [] }, end: null },
]) {
  test(`MIG-0737 U01 editor: failed commit resolves focus against ${scenario.name}`, async () => {
    let finish;
    const sent = [];
    let refreshes = 0;
    const props = { data: editorData(), allowMutations: true, onRefresh: () => { refreshes++; },
      fetchFn: (_, init) => { sent.push(JSON.parse(init.body)); return new Promise(resolve => { finish = resolve; }); },
    };
    const ui = await mount(props);
    try {
      await openDraft(ui, "Rejected", scenario.row);
      await click(ui, "セルを保存");
      await ui.render({ ...props, data: scenario.next });
      await React.act(async () => finish(json(500, { ok: false })));
      await flush();
      assert.deepEqual(sent, [{ table: "videos", primaryKey: { id: `v${scenario.row}` }, column: "title", value: "Rejected" }]);
      assert.equal(refreshes, 0);
      assert.equal(ui.host.querySelector('[data-grid-cell] input') === null, true);
      assert.deepEqual(selectedCoordinates(ui), scenario.end === null ? [] : [scenario.end]);
      const tabbable = [...ui.host.querySelectorAll('[data-grid-cell][tabindex="0"]')].map(cell => cell.dataset.gridCell);
      assert.deepEqual(tabbable, scenario.end === null ? [] : [scenario.end]);
      if (scenario.end !== null) assert.equal(document.activeElement?.getAttribute("data-grid-cell"), scenario.end);
    } finally { await ui.cleanup(); }
  });
}


async function openContextMenu(ui, selector, x = 2000, y = 2000) {
  const target = ui.host.querySelector(selector);
  assert.ok(target, "context-menu target missing: " + selector);
  const event = new dom.window.MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
  });
  await React.act(async () => { target.dispatchEvent(event); });
  await flush();
  return event;
}

function contextMenuItems(ui) {
  return [...ui.host.querySelectorAll('[data-spreadsheet-context-menu] [role="menuitem"]')];
}

test("MIG-0737 U01 context menu: right-click opens a bounded read-only menu and closes on Escape/outside press", async () => {
  const ui = await mount({ data: fixture(), onRefresh: () => {}, fetchFn: async () => json(200, { ok: true }) });
  const outside = document.createElement("button");
  document.body.append(outside);
  try {
    const event = await openContextMenu(ui, '[data-grid-cell="0:1"]');
    assert.equal(event.defaultPrevented, true);
    const menu = ui.host.querySelector('[data-spreadsheet-context-menu][role="menu"]');
    assert.ok(menu);
    assert.equal(menu.style.left, "804px");
    assert.equal(menu.style.top, "448px");
    assert.deepEqual(contextMenuItems(ui).map(item => item.textContent), [
      "編集 (F2)", "コピー (Ctrl+C)", "行を追加…", "行を削除",
    ]);
    assert.equal(contextMenuItems(ui)[0].disabled, true);
    assert.equal(contextMenuItems(ui)[1].disabled, false);
    assert.equal(contextMenuItems(ui)[2].disabled, true);
    assert.equal(contextMenuItems(ui)[3].disabled, true);
    await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    await flush();
    assert.equal(ui.host.querySelector('[data-spreadsheet-context-menu]'), null);
    await openContextMenu(ui, '[data-grid-row-header="0"]', 20, 30);
    assert.ok(ui.host.querySelector('[data-spreadsheet-context-menu]'));
    await React.act(async () => outside.dispatchEvent(new dom.window.MouseEvent("mousedown", {
      bubbles: true, cancelable: true, button: 0,
    })));
    await flush();
    assert.equal(ui.host.querySelector('[data-spreadsheet-context-menu]'), null);
  } finally { outside.remove(); await ui.cleanup(); }
});

test("MIG-0737 U01 context menu: right-click preserves an in-range selection and selects an outside cell", async () => {
  const data = fixture("videos", "editable", 1, [
    { id: "v1", title: "Alpha", secret: "first" },
    { id: "v2", title: "Beta", secret: "second" },
  ]);
  const ui = await mount({ data, allowMutations: true, onRefresh: () => {}, fetchFn: async () => saveResponse() });
  try {
    const first = ui.host.querySelector('[data-grid-cell="0:1"]');
    const second = ui.host.querySelector('[data-grid-cell="1:1"]');
    await React.act(async () => {
      first.dispatchEvent(new dom.window.MouseEvent("mousedown", {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
      }));
      second.dispatchEvent(new dom.window.MouseEvent("mousedown", {
        bubbles: true, cancelable: true, button: 0, buttons: 1, shiftKey: true,
      }));
      window.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
    });
    await flush();
    assert.deepEqual(selectedCoordinates(ui), ["0:1", "1:1"]);
    await openContextMenu(ui, '[data-grid-cell="1:1"]', 20, 30);
    assert.deepEqual(selectedCoordinates(ui), ["0:1", "1:1"]);
    await openContextMenu(ui, '[data-grid-cell="0:2"]', 30, 40);
    assert.deepEqual(selectedCoordinates(ui), ["0:2"]);
    assert.equal(contextMenuItems(ui)[0].disabled, true);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 context menu: edit and add-row actions reuse guarded grid controls", async () => {
  const ui = await mount({ data: fixture(), allowMutations: true, onRefresh: () => {}, fetchFn: async () => saveResponse() });
  try {
    await openContextMenu(ui, '[data-grid-cell="0:1"]', 20, 30);
    assert.equal(contextMenuItems(ui)[0].disabled, false);
    await click(ui, "編集 (F2)");
    assert.equal(ui.host.querySelector('[data-grid-cell="0:1"] input') !== null, true);
    assert.equal(ui.host.querySelector('[data-spreadsheet-context-menu]'), null);
    await click(ui, "キャンセル");
    await openContextMenu(ui, '[data-grid-row-header="0"]', 20, 30);
    assert.equal(contextMenuItems(ui)[0].disabled, true);
    await click(ui, "行を追加…");
    assert.equal(ui.host.querySelector('[data-spreadsheet-context-menu]'), null);
    const insertInputs = [...ui.host.querySelectorAll('[aria-label="新規行フォーム"] input')];
    assert.equal(insertInputs.length, 2);
    assert.deepEqual(insertInputs.map(field => field.value), ["", "<unsafe>"]);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01 context menu: copy uses the current selected range and delete keeps confirmation", async () => {
  const previousClipboard = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  const copied = [];
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true, value: { writeText: async value => { copied.push(value); } },
  });
  let approved = false;
  let prompts = 0;
  const deleteMessages = [];
  let refreshes = 0;
  const requests = [];
  const data = fixture("videos", "editable", 1, [
    { id: "v1", title: "Alpha", secret: "first" },
    { id: "v2", title: "Beta", secret: "second" },
  ]);
  const ui = await mount({ data, allowMutations: true, onRefresh: () => { refreshes++; },
    confirmDelete: message => { prompts++; deleteMessages.push(message); assert.match(message, /削除/); return approved; },
    fetchFn: async (_, init) => { requests.push({ method: init.method, body: JSON.parse(init.body) }); return saveResponse(); },
  });
  try {
    await openContextMenu(ui, '[data-grid-cell="0:1"]', 20, 30);
    await click(ui, "コピー (Ctrl+C)");
    assert.deepEqual(copied, ["Alpha"]);
    assert.match(ui.host.textContent, /選択範囲をコピーしました/);
    assert.equal(ui.host.querySelector('[data-spreadsheet-context-menu]'), null);
    await openContextMenu(ui, '[data-grid-cell="1:1"]', 20, 30);
    await click(ui, "行を削除");
    assert.equal(prompts, 1);
    assert.deepEqual(deleteMessages, ["行 2 を削除しますか？"]);
    assert.equal(requests.length, 0);
    assert.equal(refreshes, 0);
    approved = true;
    await openContextMenu(ui, '[data-grid-cell="1:1"]', 20, 30);
    await click(ui, "行を削除");
    assert.equal(prompts, 2);
    assert.deepEqual(deleteMessages, ["行 2 を削除しますか？", "行 2 を削除しますか？"]);
    assert.deepEqual(requests, [{ method: "DELETE", body: { table: "videos", primaryKey: { id: "v2" } } }]);
    assert.equal(refreshes, 1);
    assert.equal(ui.host.querySelector('[data-spreadsheet-context-menu]'), null);
  } finally {
    await ui.cleanup();
    if (previousClipboard) Object.defineProperty(dom.window.navigator, "clipboard", previousClipboard);
    else delete dom.window.navigator.clipboard;
  }
});

test("MIG-0737 U01 context menu: an active edit draft is not discarded by right-click", async () => {
  const ui = await mount({ data: fixture(), allowMutations: true, onRefresh: () => {}, fetchFn: async () => saveResponse() });
  try {
    await openDraft(ui, "Unsaved context draft");
    const event = await openContextMenu(ui, '[data-grid-cell="0:1"]', 20, 30);
    assert.equal(event.defaultPrevented, true);
    assert.equal(ui.host.querySelector('[data-spreadsheet-context-menu]'), null);
    assert.equal(editedInput(ui).value, "Unsaved context draft");
    assert.equal(namedButton(ui, "セルを保存").disabled, false);
  } finally { await ui.cleanup(); }
});

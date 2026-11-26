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

for (const staleStatus of [200, 403]) {
  test("MIG-0737 U01: old post-write GET (" + staleStatus + ") cannot overwrite a newer A-B-A page", async () => {
    let resolveOld;
    const oldResponse = new Promise(resolve => { resolveOld = resolve; });
    let oldSignal;
    let videoReads = 0;
    const writes = [];
    const fn = async (path, init) => {
      if (path.includes("/tables")) return json(200, catalog);
      if (init.method === "PATCH") {
        writes.push(JSON.parse(init.body));
        return json(200, { ok: true });
      }
      const table = new URL(path, "https://flamenode.test").searchParams.get("table");
      if (table === "events") return json(200, page("events", "other-table"));
      videoReads++;
      if (videoReads === 1) return json(200, page("videos", "before"));
      if (videoReads === 2) {
        oldSignal = init.signal;
        // The mocked transport deliberately ignores cancellation.
        return oldResponse;
      }
      return json(200, page("videos", "new-authorized-value"));
    };
    const ui = await mount({ fetchFn: fn, initialTable: "videos", enableMutations: true });
    try {
      await click(ui, "1行 title を編集");
      const editor = ui.host.querySelector("label input[type=text]");
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      await React.act(async () => {
        setter.call(editor, "committed-value");
        editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await click(ui, "セルを保存");
      assert.equal(videoReads, 2);
      assert.ok(oldSignal instanceof AbortSignal);
      assert.equal(oldSignal.aborted, false);
      await click(ui, "イベント (RO)");
      assert.equal(oldSignal.aborted, true);
      assert.match(ui.host.textContent, /other-table/);
      await click(ui, "動画 (RW)");
      assert.equal(videoReads, 3);
      assert.match(ui.host.textContent, /new-authorized-value/);
      await click(ui, "1行 title を編集");
      const newerEditor = ui.host.querySelector("label input[type=text]");
      assert.ok(newerEditor);
      await React.act(async () => {
        setter.call(newerEditor, "new-draft");
        newerEditor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await React.act(async () => {
        resolveOld(staleStatus === 200 ? json(200, page("videos", "old-response")) :
          json(403, { reason: "forbidden" }));
        await new Promise(resolve => setImmediate(resolve));
      });
      await flush();
      assert.doesNotMatch(ui.host.textContent, /old-response|管理者権限が必要/);
      assert.equal(ui.host.querySelector("label input[type=text]"), newerEditor);
      assert.equal(newerEditor.value, "new-draft");
      assert.deepEqual(writes, [{ table: "videos", primaryKey: { id: "v1" },
        column: "title", value: "committed-value" }]);
      assert.equal(videoReads, 3);
    } finally {
      resolveOld(json(200, page("videos", "unused")));
      await ui.cleanup();
    }
  });
}


test("MIG-0737 U01: reselecting the ready editable table preserves the live cell draft", async () => {
  const requests = [];
  const fn = async (path, init) => {
    requests.push({ path, method: init.method });
    return path.includes("/tables") ? json(200, catalog) : json(200, page("videos"));
  };
  const ui = await mount({ fetchFn: fn, initialTable: "videos", enableMutations: true });
  try {
    await click(ui, "1行 title を編集");
    const input = ui.host.querySelector("label input[type=text]");
    assert.ok(input);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await React.act(async () => {
      setter.call(input, "unsaved draft");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await click(ui, "動画 (RW)");
    assert.equal(ui.host.querySelector("label input[type=text]"), input);
    assert.equal(input.value, "unsaved draft");
    assert.equal(requests.filter(x => x.path.includes("/data")).length, 1);
    assert.ok(requests.every(x => x.method === "GET"));
    assert.ok(![...ui.host.querySelectorAll("button")].some(b => b.textContent.trim() === "再読込"),
      "ready editable grid must not expose a reload that would discard the draft");
  } finally { await ui.cleanup(); }
});

for (const denial of [
  { name: "anonymous", status: 401, body: {} },
  { name: "forbidden", status: 403, body: { reason: "admin_required" } },
  { name: "raw-403-empty", status: 403, response: () => new Response(null, { status: 403 }) },
  { name: "raw-403-html", status: 403, response: () => new Response("<html>denied</html>", { status: 403 }) },
  { name: "raw-403-null", status: 403, body: null },
  { name: "raw-403-array", status: 403, body: [] },
  { name: "disabled", status: 404, body: { error: "spreadsheet_disabled" } },
]) {
  test("MIG-0737 U01 export denial: post-mutation " + denial.name + " GET fences pending delivery without replay", async () => {
    const requests = [];
    let resolveExport;
    const pendingExport = new Promise(resolve => { resolveExport = resolve; });
    let reads = 0;
    let signal;
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    const oldClick = dom.window.HTMLAnchorElement.prototype.click;
    const delivered = [];
    URL.createObjectURL = () => "blob:pending-export";
    URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () { delivered.push(this.download); };
    const fn = async (path, init) => {
      requests.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (path.includes("/tables")) return json(200, catalog);
      if (path.includes("/export")) { signal = init.signal; return pendingExport; }
      if (init.method === "PATCH") return json(200, { ok: true });
      return ++reads === 1 ? json(200, page("videos")) : (denial.response?.() ?? json(denial.status, denial.body));
    };
    const ui = await mount({ fetchFn: fn, initialTable: "videos", enableMutations: true });
    try {
      await click(ui, "CSV ダウンロード");
      await click(ui, "1行 title を編集");
      const input = ui.host.querySelector("label input[type=text]");
      assert.ok(input);
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      await React.act(async () => {
        setter.call(input, "after");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await click(ui, "セルを保存");
      assert.equal(ui.host.querySelector("table") === null, true);
      if (denial.status === 403) assert.match(ui.host.textContent, /管理者権限が必要です/);
      await React.act(async () => resolveExport(new Response("old export", {
        headers: { "content-type": "text/csv" },
      })));
      await flush();
      assert.deepEqual(delivered, []);
      assert.equal(signal.aborted, true);
      assert.deepEqual(requests.filter(x => x.method === "PATCH").map(x => x.body), [
        { table: "videos", primaryKey: { id: "v1" }, column: "title", value: "after" },
      ]);
      assert.equal(reads, 2);
      assert.doesNotMatch(ui.host.textContent, /ダウンロードしました/);
    } finally {
      await ui.cleanup();
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
      dom.window.HTMLAnchorElement.prototype.click = oldClick;
    }
  });
}


test("MIG-0737 U01 export denial headers: post-mutation 403 fences delivery before metadata without replay", async () => {
  const requests = [];
  let resolveExport;
  let resolveMetadata;
  const pendingExport = new Promise(resolve => { resolveExport = resolve; });
  const pendingMetadata = new Promise(resolve => { resolveMetadata = resolve; });
  let reads = 0;
  let signal;
  let abortedAtBodyStart;
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  const oldClick = dom.window.HTMLAnchorElement.prototype.click;
  const delivered = [];
  URL.createObjectURL = () => "blob:pending-export";
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { delivered.push(this.download); };
  const fn = async (path, init) => {
    requests.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (path.includes("/tables")) return json(200, catalog);
    if (path.includes("/export")) { signal = init.signal; return pendingExport; }
    if (init.method === "PATCH") return json(200, { ok: true });
    if (++reads === 1) return json(200, page("videos"));
    const response = json(403, {});
    response.json = () => {
      abortedAtBodyStart = signal.aborted;
      resolveExport(new Response("old export", { headers: { "content-type": "text/csv" } }));
      return pendingMetadata;
    };
    return response;
  };
  const ui = await mount({ fetchFn: fn, initialTable: "videos", enableMutations: true });
  try {
    await click(ui, "CSV ダウンロード");
    await click(ui, "1行 title を編集");
    const input = ui.host.querySelector("label input[type=text]");
    assert.ok(input);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await React.act(async () => {
      setter.call(input, "after");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await click(ui, "セルを保存");
    await flush();
    assert.equal(abortedAtBodyStart, true);
    assert.equal(signal.aborted, true);
    assert.equal(ui.host.querySelector("table"), null);
    assert.match(ui.host.textContent, /管理者権限が必要です/);
    assert.deepEqual(delivered, []);
    await React.act(async () => resolveMetadata({ reason: "admin_required" }));
    await flush();
    assert.deepEqual(delivered, []);
    assert.deepEqual(requests.filter(x => x.method === "PATCH").map(x => x.body), [
      { table: "videos", primaryKey: { id: "v1" }, column: "title", value: "after" },
    ]);
    assert.equal(reads, 2);
  } finally {
    resolveMetadata({});
    await ui.cleanup();
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
    dom.window.HTMLAnchorElement.prototype.click = oldClick;
  }
});

// Control only the optional-403-body deadline, so the pre-deadline delivery window never depends on wall time.
function holdForbiddenBodyDeadline() {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const pending = new Map();
  const held = new Set();
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 250) return originalSet(callback, delay, ...args);
    const handle = {};
    held.add(handle);
    pending.set(handle, () => callback(...args));
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    if (held.has(handle)) pending.delete(handle);
    else originalClear(handle);
  };
  return {
    get pending() { return pending.size; },
    expire() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    restore() {
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
      pending.clear();
      held.clear();
    },
  };
}

for (const completion of ["metadata", "deadline"]) {
  // Exercise the actual PATCH-to-GET caller, including delivery while its optional 403 body remains pending.
  test("MIG-0737 U01 raw403: post-mutation GET retires old delivery before " + completion + " completion without replaying the PATCH", async () => {
    const deadline = holdForbiddenBodyDeadline();
    const requests = [];
    const signals = [];
    let resolveExport;
    let resolveReplacement;
    let resolveMetadata;
    const pendingExport = new Promise(resolve => { resolveExport = resolve; });
    const replacementExport = new Promise(resolve => { resolveReplacement = resolve; });
    const metadata = new Promise(resolve => { resolveMetadata = resolve; });
    let reads = 0;
    let metadataStarted = false;
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    const oldClick = dom.window.HTMLAnchorElement.prototype.click;
    const created = [];
    const delivered = [];
    URL.createObjectURL = (blob) => { created.push(blob); return "blob:raw403-export"; };
    URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () { delivered.push(this.download); };
    const fn = async (path, init) => {
      requests.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (path.includes("/tables")) return json(200, catalog);
      if (path.includes("/export")) {
        signals.push(init.signal);
        return signals.length === 1 ? pendingExport : replacementExport;
      }
      if (init.method === "PATCH") return json(200, { ok: true });
      if (++reads === 1) return json(200, page("videos"));
      const response = json(403, { reason: "admin_required" });
      response.json = () => { metadataStarted = true; return metadata; };
      return response;
    };
    const ui = await mount({ fetchFn: fn, initialTable: "videos", enableMutations: true });
    try {
      await click(ui, "CSV ダウンロード");
      await click(ui, "1行 title を編集");
      const input = ui.host.querySelector("label input[type=text]");
      assert.ok(input);
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      await React.act(async () => {
        setter.call(input, "after");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await click(ui, "セルを保存");
      assert.equal(reads, 2);
      assert.equal(metadataStarted, true);
      assert.equal(deadline.pending, 1, "neither metadata nor its deadline has settled");
      assert.equal(signals[0].aborted, true, "the refresh response retires export before its optional body finishes");
      const writes = () => requests.filter(x => x.method === "PATCH").map(x => x.body);
      const expectedWrites = [{ table: "videos", primaryKey: { id: "v1" }, column: "title", value: "after" }];
      assert.deepEqual(writes(), expectedWrites);
      const patchIndex = requests.findIndex(x => x.method === "PATCH");
      assert.equal(requests[patchIndex + 1].method, "GET");
      assert.equal(requests[patchIndex + 1].path, "/api/admin/spreadsheet/data?table=videos&page=1");
      assert.equal(ui.host.querySelector("table"), null, "the post-write header denial unmounts the grid before metadata");
      assert.match(ui.host.textContent, /管理者権限が必要/);
      assert.doesNotMatch(ui.host.textContent, /データを取得できませんでした/);
      await React.act(async () => resolveExport(new Response("old export", { headers: { "content-type": "text/csv" } })));
      await flush();
      assert.deepEqual(created, []);
      assert.deepEqual(delivered, []);
      assert.doesNotMatch(ui.host.textContent, /ダウンロードしました/);
      assert.equal(deadline.pending, 1, "old response delivery was fenced before the metadata deadline");
      await click(ui, "CSV ダウンロード");
      assert.equal(signals.length, 2);
      await React.act(async () => {
        if (completion === "deadline") deadline.expire();
        else resolveMetadata({ reason: "admin_required", redirect: "/dashboard" });
      });
      await flush();
      assert.equal(deadline.pending, 0);
      assert.match(ui.host.textContent, /管理者権限が必要/);
      assert.equal(ui.host.querySelector("table"), null, "metadata completion preserves the already committed denial");
      assert.equal(signals[1].aborted, false, "the same refresh cannot revoke the replacement a second time");
      const download = [...ui.host.querySelectorAll("button")].find(button => button.textContent === "CSV ダウンロード");
      assert.equal(download.disabled, true);
      await React.act(async () => resolveReplacement(new Response("replacement export", { headers: { "content-type": "text/csv" } })));
      await flush();
      assert.deepEqual(delivered, ["videos.csv"]);
      assert.equal(await created[0].text(), "replacement export");
      if (completion === "deadline") {
        await React.act(async () => resolveMetadata({ reason: "late metadata", redirect: "/dashboard" }));
        await flush();
        assert.equal(signals[1].aborted, false);
        assert.match(ui.host.textContent, /CSV をダウンロードしました/, "late metadata cannot erase the new receipt");
      }
      assert.deepEqual(writes(), expectedWrites, "neither denial nor delayed metadata replays the successful PATCH");
      assert.equal(reads, 2);
      assert.ok(requests.every(request => request.method === "GET" || request.method === "PATCH"));
    } finally {
      await ui.cleanup();
      resolveExport(new Response("unused", { headers: { "content-type": "text/csv" } }));
      resolveReplacement(new Response("unused", { headers: { "content-type": "text/csv" } }));
      resolveMetadata({ reason: "admin_required" });
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
      dom.window.HTMLAnchorElement.prototype.click = oldClick;
      deadline.restore();
    }
  });
}

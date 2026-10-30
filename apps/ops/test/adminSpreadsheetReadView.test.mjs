import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { AdminSpreadsheetReadView } from "../.test-dist/apps/ops/src/routes/admin/AdminSpreadsheetReadView.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/spreadsheet",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const table = (name, mode = "editable") =>
  ({ table: name, label: name === "videos" ? "動画" : "イベント", group: "コンテンツ", mode });
const catalog = {
  tables: [table("videos"), table("events", "readonly")],
  groups: { "コンテンツ": [table("videos"), table("events", "readonly")] },
  pageSize: 50,
  discoveredAt: "2026-10-30T00:00:00.000Z",
};
function page(name, current, hasMore = false) {
  return {
    def: table(name), columns: [{ name: "title", type: "TEXT", notNull: false, pk: 0, editable: true }],
    primaryKeys: ["id"], rows: [{ title: current === 1 ? "<unsafe>" : "page two" }],
    hasMore, page: current, limit: 50,
  };
}
const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
async function flush() {
  await React.act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
}
async function mount(fetchFn, initialTable) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => {
    root.render(React.createElement(AdminSpreadsheetReadView, { fetchFn, initialTable }));
  });
  await flush();
  await flush();
  return {
    host,
    cleanup: async () => {
      await React.act(async () => root.unmount());
      host.remove();
    },
  };
}

test("MIG-0737 U01: initial SSR is inert and contains no user data", () => {
  const html = renderToStaticMarkup(React.createElement(AdminSpreadsheetReadView));
  assert.match(html, /テーブルを読み込み中/);
  assert.doesNotMatch(html, /<form|<input|<button/);
});

test("MIG-0737 U01: reads known table rows, escapes content, pages and switches tables", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/tables")) return json(200, catalog);
    const params = new URL("https://flamenode.test" + url).searchParams;
    return json(200, page(params.get("table"), Number(params.get("page")), Number(params.get("page")) === 1));
  };
  const ui = await mount(fetchFn, "videos");
  try {
    assert.match(ui.host.textContent, /動画/);
    assert.match(ui.host.textContent, /<unsafe>/);
    assert.match(ui.host.innerHTML, /&lt;unsafe&gt;/);
    assert.doesNotMatch(ui.host.innerHTML, /<unsafe>/);
    assert.equal(ui.host.querySelectorAll("input,form,textarea,[contenteditable=true]").length, 0);
    const next = [...ui.host.querySelectorAll("button")].find((b) => b.textContent === "次へ");
    assert.equal(next.disabled, false);
    await React.act(async () => next.click());
    await flush();
    assert.match(ui.host.textContent, /page two/);
    const event = [...ui.host.querySelectorAll("nav button")].find((b) => b.textContent.includes("イベント"));
    await React.act(async () => event.click());
    await flush();
    assert.match(ui.host.textContent, /イベント/);
    assert.equal(event.getAttribute("aria-pressed"), "true");
    assert.ok(calls.some((x) => x.url === "/api/admin/spreadsheet/data?table=videos&page=2"));
    assert.ok(calls.some((x) => x.url === "/api/admin/spreadsheet/data?table=events&page=1"));
    for (const { init } of calls) {
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.cache, "no-store");
    }
  } finally { await ui.cleanup(); }
});

test("MIG-0737 T01: only explicit disabled 404 shows CURRENT disabled copy", async () => {
  const ui = await mount(async () => json(404, { error: "spreadsheet_disabled" }));
  try {
    assert.match(ui.host.textContent, /ADMIN_SPREADSHEET_ENABLED=true/);
    assert.match(ui.host.textContent, /npm run dev/);
    assert.equal(ui.host.querySelectorAll("table,nav button").length, 0);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: generic 404 and anonymous are not treated as a disabled feature", async () => {
  for (const [status, body, expected] of [
    [404, { error: "unknown_table" }, "テーブルが見つかりません。"],
    [401, { error: "unauthorized" }, "ログインが必要です。"],
    [403, { reason: "admin_required" }, "管理者権限が必要です。"],
  ]) {
    const ui = await mount(async () => json(status, body));
    try {
      assert.match(ui.host.textContent, new RegExp(expected));
      assert.doesNotMatch(ui.host.textContent, /ADMIN_SPREADSHEET_ENABLED=true/);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U01: failed catalog never renders spreadsheet data or writes", async () => {
  const ui = await mount(async () => { throw Error("offline"); });
  try {
    assert.match(ui.host.textContent, /データを取得できませんでした/);
    assert.equal(ui.host.querySelectorAll("table,nav button").length, 0);
  } finally { await ui.cleanup(); }
});

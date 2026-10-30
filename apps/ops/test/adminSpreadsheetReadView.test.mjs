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

test("MIG-0737 U01: CSV and TSV download clicks are GET-only and revoke blob URLs", async () => {
  const calls = [];
  const downloads = [];
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  const oldClick = dom.window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = () => "blob:https://flamenode.test/export";
  URL.revokeObjectURL = (url) => downloads.push(["revoke", url]);
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(["click", this.download, this.href]);
  };
  const ui = await mount(async (path, init) => {
    calls.push({ path, init });
    if (path.includes("/tables")) return json(200, catalog);
    if (path.includes("/data")) return json(200, page("videos", 1));
    if (path.includes("/export")) {
      const tsv = path.includes("format=tsv");
      return new Response(tsv ? "id\tname" : "id,name", {
        status: 200,
        headers: {
          "content-type": tsv ? "text/tab-separated-values" : "text/csv",
          "X-Spreadsheet-Truncated": tsv ? "1" : "0",
        },
      });
    }
    throw Error("unexpected API path");
  }, "videos");
  try {
    const csv = [...ui.host.querySelectorAll("button")].find(b => b.textContent === "CSV ダウンロード");
    const tsv = [...ui.host.querySelectorAll("button")].find(b => b.textContent === "TSV ダウンロード");
    assert.ok(csv);
    assert.ok(tsv);
    await React.act(async () => csv.click());
    await flush();
    await React.act(async () => tsv.click());
    await flush();
    assert.ok(downloads.some(x => x[0] === "click" && x[1] === "videos.csv"));
    assert.ok(downloads.some(x => x[0] === "click" && x[1] === "videos-partial.tsv"));
    assert.equal(downloads.filter(x => x[0] === "revoke").length, 2);
    assert.match(ui.host.textContent, /一部のデータのみ保存しました/);
    assert.ok(calls.some(x => x.path.includes("/export?table=videos&format=csv&header=1")));
    assert.ok(calls.some(x => x.path.includes("/export?table=videos&format=tsv&header=1")));
    assert.ok(calls.every(x => x.init.method === "GET"));
  } finally {
    await ui.cleanup();
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
    dom.window.HTMLAnchorElement.prototype.click = oldClick;
  }
});

test("MIG-0737 U01: export JSON response is not downloaded", async () => {
  let downloaded = 0;
  const oldCreate = URL.createObjectURL;
  URL.createObjectURL = () => { downloaded++; return "blob:invalid"; };
  const ui = await mount(async (path) => {
    if (path.includes("/tables")) return json(200, catalog);
    if (path.includes("/data")) return json(200, page("videos", 1));
    return json(200, { error: "invalid_response" });
  });
  try {
    const csv = [...ui.host.querySelectorAll("button")].find(b => b.textContent === "CSV ダウンロード");
    await React.act(async () => csv.click());
    await flush();
    assert.equal(downloaded, 0);
    assert.match(ui.host.textContent, /データを取得できませんでした/);
  } finally {
    await ui.cleanup();
    URL.createObjectURL = oldCreate;
  }
});

test("MIG-0737 U01: CSV clipboard copy supports primary API and denied-grant fallback", async () => {
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const oldExec = document.execCommand;
  const copied = [];
  let usedFallback = false;
  const fetchFn = async (path, init) => {
    assert.equal(init.method, "GET");
    if (path.includes("/tables")) return json(200, catalog);
    if (path.includes("/data")) return json(200, page("videos", 1));
    return new Response("id,name\n1,value", { status: 200, headers: {
      "content-type": "text/csv", "X-Spreadsheet-Truncated": "1",
    } });
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (body) => copied.push(body),
  } });
  const ui = await mount(fetchFn, "videos");
  try {
    const button = [...ui.host.querySelectorAll("button")].find(x => x.textContent === "コピー (CSV)");
    assert.ok(button);
    await React.act(async () => button.click());
    await flush();
    assert.deepEqual(copied, ["id,name\n1,value"]);
    assert.match(ui.host.textContent, /クリップボードにコピーしました（件数上限で一部のみ）/);

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw Error("permission denied"); },
    } });
    document.execCommand = (command) => {
      assert.equal(command, "copy");
      usedFallback = true;
      return true;
    };
    await React.act(async () => button.click());
    await flush();
    assert.equal(usedFallback, true);
    assert.equal(ui.host.querySelectorAll("textarea").length, 0);

    document.execCommand = () => false;
    await React.act(async () => button.click());
    await flush();
    assert.match(ui.host.textContent, /クリップボードへのコピーに失敗しました/);
  } finally {
    await ui.cleanup();
    if (oldClipboard) Object.defineProperty(navigator, "clipboard", oldClipboard);
    else delete navigator.clipboard;
    document.execCommand = oldExec;
  }
});

test("MIG-0737 U01: previous-page navigation hides stale rows until the new response", async () => {
  let blockPrevious = false;
  let resolvePrevious;
  const fetchFn = async (path) => {
    if (path.includes("/tables")) return json(200, catalog);
    if (!path.includes("/data")) throw Error("unexpected export request");
    const requestedPage = Number(new URL("https://flamenode.test" + path).searchParams.get("page"));
    if (blockPrevious && requestedPage === 1) {
      return new Promise((resolve) => { resolvePrevious = resolve; });
    }
    return json(200, page("videos", requestedPage, requestedPage === 1));
  };
  const ui = await mount(fetchFn, "videos");
  try {
    const next = [...ui.host.querySelectorAll("button")].find(b => b.textContent === "次へ");
    await React.act(async () => next.click());
    await flush();
    assert.match(ui.host.textContent, /page two/);
    blockPrevious = true;
    const prev = [...ui.host.querySelectorAll("button")].find(b => b.textContent === "前へ");
    await React.act(async () => prev.click());
    assert.ok(resolvePrevious, "new page was requested");
    assert.doesNotMatch(ui.host.textContent, /page two/);
    assert.match(ui.host.textContent, /読み込み中/);
    await React.act(async () => resolvePrevious(json(200, page("videos", 1, true))));
    await flush();
    assert.match(ui.host.textContent, /<unsafe>/);
    assert.doesNotMatch(ui.host.textContent, /page two/);
  } finally {
    await ui.cleanup();
  }
});

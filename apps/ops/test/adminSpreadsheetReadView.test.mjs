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
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function exportResponse(format = "csv", body = "id,name\n1,private export") {
  return new Response(body, { headers: {
    "content-type": format === "tsv" ? "text/tab-separated-values" : "text/csv",
  } });
}
function fetchWithExport(exportFn) {
  return async (path, init) => {
    if (path.includes("/tables")) return json(200, catalog);
    const params = new URL("https://flamenode.test" + path).searchParams;
    if (path.includes("/data")) {
      const currentPage = Number(params.get("page"));
      return json(200, page(params.get("table"), currentPage, currentPage === 1));
    }
    assert.match(path, /\/export\?/);
    return exportFn(path, init);
  };
}
function observeExports() {
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  const oldClick = dom.window.HTMLAnchorElement.prototype.click;
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const oldExec = document.execCommand;
  const effects = { created: [], downloaded: [], revoked: [], copied: [], fallback: [] };
  const clipboard = { writeText: async (body) => { effects.copied.push(body); } };
  URL.createObjectURL = (blob) => {
    effects.created.push(blob);
    return `blob:https://flamenode.test/export-${effects.created.length}`;
  };
  URL.revokeObjectURL = (url) => effects.revoked.push(url);
  dom.window.HTMLAnchorElement.prototype.click = function () {
    effects.downloaded.push(this.download);
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  document.execCommand = (command) => {
    effects.fallback.push({ command, body: document.querySelector("textarea")?.value });
    return true;
  };
  return {
    effects, clipboard,
    restore() {
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
      dom.window.HTMLAnchorElement.prototype.click = oldClick;
      if (oldClipboard) Object.defineProperty(navigator, "clipboard", oldClipboard);
      else delete navigator.clipboard;
      document.execCommand = oldExec;
    },
  };
}
function exportButton(host, label = "CSV ダウンロード") {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
  assert.ok(button, `missing export control: ${label}`);
  return button;
}
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
    rerender: async (newFetchFn, newInitialTable) => {
      await React.act(async () => {
        root.render(React.createElement(AdminSpreadsheetReadView, {
          fetchFn: newFetchFn, initialTable: newInitialTable,
        }));
      });
      await flush();
    },
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

test("MIG-0737 U01: changing the API transport clears previous session rows immediately", async () => {
  let resolveCatalog;
  const firstFetch = async (path) => {
    if (path.includes("/tables")) return json(200, catalog);
    return json(200, { ...page("videos", 1), rows: [{ title: "SESSION_A_PRIVATE" }] });
  };
  const secondFetch = async (path) => {
    if (path.includes("/tables")) {
      return new Promise((resolve) => { resolveCatalog = resolve; });
    }
    return json(200, { ...page("videos", 1), rows: [{ title: "SESSION_B_PRIVATE" }] });
  };
  const ui = await mount(firstFetch, "videos");
  try {
    assert.match(ui.host.textContent, /SESSION_A_PRIVATE/);
    await ui.rerender(secondFetch, "videos");
    assert.ok(resolveCatalog, "new catalog request must run");
    assert.doesNotMatch(ui.host.textContent, /SESSION_A_PRIVATE/);
    assert.match(ui.host.textContent, /テーブルを読み込み中/);
    await React.act(async () => resolveCatalog(json(200, catalog)));
    await flush();
    assert.match(ui.host.textContent, /SESSION_B_PRIVATE/);
    assert.doesNotMatch(ui.host.textContent, /SESSION_A_PRIVATE/);
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0737 U01: mismatched server page/table identities never render rows", async () => {
  for (const wrongPage of [page("events", 1), page("videos", 2)]) {
    const ui = await mount(async (path) =>
      path.includes("/tables") ? json(200, catalog) : json(200, wrongPage), "videos");
    try {
      assert.equal(ui.host.querySelectorAll("tbody tr").length, 0);
      assert.doesNotMatch(ui.host.textContent, /<unsafe>/);
      assert.match(ui.host.textContent, /データを取得できませんでした/);
    } finally {
      await ui.cleanup();
    }
  }
});

for (const contextChange of ["transport", "initialTable"]) {
  for (const [label, format] of [
    ["CSV ダウンロード", "csv"], ["TSV ダウンロード", "tsv"], ["コピー (CSV)", "csv"],
  ]) {
    test(`MIG-0737 U01: ${contextChange} cancels pending ${label} even when the table stays videos`, async () => {
      const observed = observeExports();
      const pending = deferred();
      let signal;
      const firstFetch = fetchWithExport((_path, init) => {
        signal = init.signal;
        return pending.promise;
      });
      const secondFetch = fetchWithExport(() => exportResponse(format));
      const ui = await mount(firstFetch, "videos");
      try {
        await React.act(async () => exportButton(ui.host, label).click());
        assert.ok(signal);
        assert.equal(exportButton(ui.host, label).disabled, true);
        await ui.rerender(contextChange === "transport" ? secondFetch : firstFetch,
          contextChange === "transport" ? "videos" : "not-in-catalog");
        assert.equal(ui.host.querySelector('nav button[aria-pressed="true"]')?.textContent, "動画 (RW)");
        assert.equal(signal.aborted, true);
        assert.equal(exportButton(ui.host, label).disabled, false);
        // This transport deliberately ignores AbortSignal and still returns its old data.
        await React.act(async () => pending.resolve(exportResponse(format)));
        await flush();
        assert.deepEqual(observed.effects, { created: [], downloaded: [], revoked: [], copied: [], fallback: [] });
        assert.doesNotMatch(ui.host.textContent, /ダウンロードしました|コピーしました|エクスポートに失敗/);
      } finally {
        await ui.cleanup();
        observed.restore();
      }
    });
  }
}

test("MIG-0737 U01: a pending blob text read cannot copy after transport replacement", async () => {
  const observed = observeExports();
  const pendingText = deferred();
  let textStarted = false;
  const firstFetch = fetchWithExport(() => {
    const response = exportResponse();
    const blob = new Blob(["old private data"], { type: "text/csv" });
    blob.text = () => { textStarted = true; return pendingText.promise; };
    response.blob = async () => blob;
    return response;
  });
  const secondFetch = fetchWithExport(() => exportResponse());
  const ui = await mount(firstFetch, "videos");
  try {
    await React.act(async () => exportButton(ui.host, "コピー (CSV)").click());
    await flush();
    assert.equal(textStarted, true);
    await ui.rerender(secondFetch, "videos");
    await React.act(async () => pendingText.resolve("OLD_SESSION_PRIVATE"));
    await flush();
    assert.deepEqual(observed.effects.copied, []);
    assert.deepEqual(observed.effects.fallback, []);
    assert.doesNotMatch(ui.host.textContent, /コピーしました|コピーに失敗|OLD_SESSION_PRIVATE/);
    assert.equal(exportButton(ui.host, "コピー (CSV)").disabled, false);
  } finally {
    await ui.cleanup();
    observed.restore();
  }
});

for (const outcome of ["resolve", "reject"]) {
  test(`MIG-0737 U01: old clipboard ${outcome} cannot affect a newer export after a table change`, async () => {
    const observed = observeExports();
    const pendingClipboard = deferred();
    const pendingExport = deferred();
    let newSignal;
    observed.clipboard.writeText = (body) => {
      observed.effects.copied.push(body);
      return pendingClipboard.promise;
    };
    const fetchFn = fetchWithExport((path, init) => {
      if (path.includes("table=videos")) return exportResponse();
      newSignal = init.signal;
      return pendingExport.promise;
    });
    const ui = await mount(fetchFn, "videos");
    try {
      await React.act(async () => exportButton(ui.host, "コピー (CSV)").click());
      await flush();
      assert.equal(observed.effects.copied.length, 1);
      const events = [...ui.host.querySelectorAll("nav button")].find(button => button.textContent.includes("イベント"));
      await React.act(async () => events.click());
      await flush();
      await React.act(async () => exportButton(ui.host).click());
      assert.ok(newSignal);
      assert.equal(exportButton(ui.host).disabled, true);
      await React.act(async () => pendingClipboard[outcome](outcome === "reject" ? new Error("grant denied") : undefined));
      await flush();
      assert.deepEqual(observed.effects.fallback, []);
      assert.equal(document.querySelectorAll("textarea").length, 0);
      assert.doesNotMatch(ui.host.textContent, /コピーしました|コピーに失敗|エクスポートに失敗/);
      assert.equal(newSignal.aborted, false);
      assert.equal(exportButton(ui.host).disabled, true, "old finally must not release the new export");
      await React.act(async () => pendingExport.resolve(exportResponse()));
      await flush();
      assert.deepEqual(observed.effects.downloaded, ["events.csv"]);
      assert.equal(exportButton(ui.host).disabled, false);
    } finally {
      await ui.cleanup();
      observed.restore();
    }
  });
}

test("MIG-0737 U01: unmount prevents delayed clipboard rejection from using the fallback", async () => {
  const observed = observeExports();
  const pendingClipboard = deferred();
  observed.clipboard.writeText = (body) => {
    observed.effects.copied.push(body);
    return pendingClipboard.promise;
  };
  const ui = await mount(fetchWithExport(() => exportResponse()), "videos");
  let unmounted = false;
  try {
    await React.act(async () => exportButton(ui.host, "コピー (CSV)").click());
    await flush();
    assert.equal(observed.effects.copied.length, 1);
    await ui.cleanup();
    unmounted = true;
    await React.act(async () => pendingClipboard.reject(new Error("grant denied after unmount")));
    await flush();
    assert.deepEqual(observed.effects.fallback, []);
    assert.equal(document.querySelectorAll("textarea").length, 0);
  } finally {
    if (!unmounted) await ui.cleanup();
    observed.restore();
  }
});

test("MIG-0737 U01: the old response cannot finish or unlock a new transport export", async () => {
  const observed = observeExports();
  const oldResponse = deferred();
  const newResponse = deferred();
  let newSignal;
  const firstFetch = fetchWithExport(() => oldResponse.promise);
  const secondFetch = fetchWithExport((_path, init) => {
    newSignal = init.signal;
    return newResponse.promise;
  });
  const ui = await mount(firstFetch, "videos");
  try {
    await React.act(async () => exportButton(ui.host).click());
    await ui.rerender(secondFetch, "videos");
    assert.equal(exportButton(ui.host).disabled, false);
    await React.act(async () => exportButton(ui.host).click());
    assert.ok(newSignal);
    await React.act(async () => oldResponse.resolve(exportResponse("csv", "OLD_SESSION_PRIVATE")));
    await flush();
    assert.deepEqual(observed.effects.created, []);
    assert.equal(exportButton(ui.host).disabled, true);
    assert.equal(newSignal.aborted, false);
    await React.act(async () => newResponse.resolve(exportResponse("csv", "NEW_SESSION_PRIVATE")));
    await flush();
    assert.deepEqual(observed.effects.downloaded, ["videos.csv"]);
    assert.equal(await observed.effects.created[0].text(), "NEW_SESSION_PRIVATE");
    assert.equal(observed.effects.revoked.length, 1);
    assert.equal(exportButton(ui.host).disabled, false);
  } finally {
    await ui.cleanup();
    observed.restore();
  }
});

test("MIG-0737 U01: completed export notices are cleared when the transport changes", async () => {
  const observed = observeExports();
  const firstFetch = fetchWithExport(() => exportResponse());
  const secondFetch = fetchWithExport(() => exportResponse());
  const ui = await mount(firstFetch, "videos");
  try {
    await React.act(async () => exportButton(ui.host).click());
    await flush();
    assert.match(ui.host.textContent, /CSV をダウンロードしました/);
    await ui.rerender(secondFetch, "videos");
    assert.doesNotMatch(ui.host.textContent, /ダウンロードしました|エクスポートに失敗/);
    assert.equal(exportButton(ui.host).disabled, false);
  } finally {
    await ui.cleanup();
    observed.restore();
  }
});

test("MIG-0737 U01: page navigation keeps a table-wide export active", async () => {
  const observed = observeExports();
  const pending = deferred();
  let signal;
  const ui = await mount(fetchWithExport((_path, init) => {
    signal = init.signal;
    return pending.promise;
  }), "videos");
  try {
    await React.act(async () => exportButton(ui.host).click());
    const next = [...ui.host.querySelectorAll("button")].find(button => button.textContent === "次へ");
    await React.act(async () => next.click());
    await flush();
    assert.match(ui.host.textContent, /page two/);
    assert.equal(signal.aborted, false);
    assert.equal(exportButton(ui.host).disabled, true);
    await React.act(async () => pending.resolve(exportResponse()));
    await flush();
    assert.deepEqual(observed.effects.downloaded, ["videos.csv"]);
    assert.equal(observed.effects.revoked.length, 1);
    assert.equal(exportButton(ui.host).disabled, false);
  } finally {
    await ui.cleanup();
    observed.restore();
  }
});

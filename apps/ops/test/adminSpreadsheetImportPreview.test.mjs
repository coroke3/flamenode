import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// React DOM must be initialized only after jsdom globals exist: input/change detection is captured at import time.
import { JSDOM } from "jsdom";
import { AdminSpreadsheetImportPreview } from "../.test-dist/apps/ops/src/routes/admin/AdminSpreadsheetImportPreview.js";

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
const preview = {
  rowCount: 1, mappedColumns: ["id", "title"], warnings: [],
  preview: [{ id: "1", title: "<PRIVATE>" }],
  previewToken: "SECRET_PREVIEW_TOKEN_12345", applyMaxRows: 7,
};
const result = { inserted: 0, updated: 1, skipped: 0 };

async function flush() {
  await React.act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
}
async function mount(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(AdminSpreadsheetImportPreview, props)));
  return {
    host,
    rerender: async (nextProps) => {
      await React.act(async () => root.render(React.createElement(AdminSpreadsheetImportPreview, nextProps)));
      await flush();
    },
    cleanup: async () => { await React.act(async () => root.unmount()); host.remove(); },
  };
}
async function typeText(ui, value) {
  const textarea = ui.host.querySelector("textarea");
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
  await React.act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function click(ui, caption) {
  const b = [...ui.host.querySelectorAll("button")].find(x => x.textContent.trim() === caption);
  assert.ok(b, "button missing: " + caption);
  assert.equal(b.disabled, false, caption + " is disabled");
  await React.act(async () => b.click());
  await flush();
}

test("MIG-0737 U01: SSR has no token or write request, apply defaults disabled", () => {
  const html = renderToStaticMarkup(React.createElement(AdminSpreadsheetImportPreview, {
    table: "videos", tableLabel: "動画",
  }));
  assert.match(html, /サーバーで確認/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /SECRET_PREVIEW_TOKEN|previewToken/);
});

test("MIG-0737 T02: preview then cancellation never submits apply", async () => {
  const requests = [];
  const ui = await mount({
    table: "videos", tableLabel: "動画",
    confirmApply: () => false,
    fetchFn: async (path, init) => {
      requests.push(JSON.parse(init.body));
      return json(200, preview);
    },
  });
  try {
    await typeText(ui, "id,title\n1,alpha");
    await click(ui, "サーバーで確認");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].dryRun, true);
    assert.equal(requests[0].previewToken, undefined);
    assert.match(ui.host.textContent, /1 行/);
    assert.match(ui.host.innerHTML, /&lt;PRIVATE&gt;/);
    assert.doesNotMatch(ui.host.innerHTML, /SECRET_PREVIEW_TOKEN_12345/);
    await click(ui, "確認後に反映");
    assert.equal(requests.length, 1);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: preview input mutation invalidates apply, requires new preview", async () => {
  const sent = [];
  const ui = await mount({
    table: "videos", tableLabel: "動画",
    fetchFn: async (_, init) => {
      sent.push(JSON.parse(init.body));
      return json(200, preview);
    },
  });
  try {
    await typeText(ui, "id,title\n1,alpha");
    await click(ui, "サーバーで確認");
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, false);
    await typeText(ui, "id,title\n2,bravo");
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.equal(sent.length, 1);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: apply is single-use, sends preview token only after explicit confirmation", async () => {
  const requests = [];
  let confirmations = 0;
  let imported = 0;
  const ui = await mount({
    table: "videos", tableLabel: "動画",
    confirmApply: () => { confirmations++; return true; },
    onImported: () => { imported++; },
    fetchFn: async (_, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return json(200, body.dryRun ? preview : result);
    },
  });
  try {
    await typeText(ui, "id,title\n1,alpha");
    await click(ui, "サーバーで確認");
    await click(ui, "確認後に反映");
    assert.equal(confirmations, 1);
    assert.equal(imported, 1);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].dryRun, true);
    assert.equal(requests[1].previewToken, preview.previewToken);
    assert.equal(requests[1].dryRun, undefined);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.doesNotMatch(ui.host.innerHTML, /SECRET_PREVIEW_TOKEN_12345/);
    assert.match(ui.host.textContent, /反映完了/);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: failed or oversized preview never unlocks apply", async () => {
  for (const reply of [json(501, { error: "unsupported" }), json(200, { ...preview, rowCount: 8 })]) {
    const ui = await mount({
      table: "videos", tableLabel: "動画", fetchFn: async () => reply.clone(),
    });
    try {
      await typeText(ui, "id,title\n1,alpha");
      await click(ui, "サーバーで確認");
      assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    } finally { await ui.cleanup(); }
  }
});

async function selectFile(ui, file) {
  const input = ui.host.querySelector('input[type="file"]');
  assert.ok(input, "file input must exist");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await React.act(async () => {
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await flush();
}

test("MIG-0737 U01: CSV/TSV file upload reads UTF-8 and switches separator without importing", async () => {
  const requests = [];
  const fetchFn = async (_, init) => { requests.push(JSON.parse(init.body)); return json(200, preview); };
  const ui = await mount({ table: "videos", tableLabel: "動画", fetchFn });
  try {
    await selectFile(ui, {
      name: "data.TSV", size: 32,
      text: async () => "id\ttitle\n1\tbravo",
    });
    assert.equal(ui.host.querySelector("textarea").value, "id\ttitle\n1\tbravo");
    assert.equal(ui.host.querySelectorAll("select")[0].value, "tsv");
    assert.equal(requests.length, 0, "reading a file must not call the server");
    await click(ui, "サーバーで確認");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].delimiter, "tsv");
    assert.equal(requests[0].dryRun, true);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, false);

    await selectFile(ui, { name: "next.csv", size: 12, text: async () => "id,title\n2,charlie" });
    assert.equal(ui.host.querySelectorAll("select")[0].value, "csv");
    assert.equal(ui.host.querySelector("textarea").value, "id,title\n2,charlie");
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true, "new file invalidates old preview");
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: files above 2 MB and unreadable files fail closed without changing text", async () => {
  const ui = await mount({ table: "videos", tableLabel: "動画" });
  try {
    let reads = 0;
    await selectFile(ui, {
      name: "too-big.csv", size: 2_000_001,
      text: async () => { reads++; return "must not be read"; },
    });
    assert.equal(reads, 0);
    assert.match(ui.host.textContent, /上限 2MB/);
    assert.equal(ui.host.querySelector("textarea").value, "");
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);

    await selectFile(ui, {
      name: "bad.csv", size: 20,
      text: async () => { throw Error("disk failed"); },
    });
    assert.match(ui.host.textContent, /ファイルの読み込みに失敗/);
    assert.equal(ui.host.querySelector("textarea").value, "");
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U01: table or API transport switch clears preview immediately and aborts in-flight dry run", async () => {
  const fetchFn = async () => json(200, preview);
  const ui = await mount({ table: "videos", tableLabel: "動画", fetchFn });
  try {
    await typeText(ui, "id,title\n1,alpha");
    await click(ui, "サーバーで確認");
    assert.match(ui.host.textContent, /&lt;PRIVATE&gt;|<PRIVATE>/);
    await ui.rerender({ table: "events", tableLabel: "イベント", fetchFn });
    assert.doesNotMatch(ui.host.textContent, /<PRIVATE>/);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    const otherFetch = async () => json(200, preview);
    await ui.rerender({ table: "events", tableLabel: "イベント", fetchFn: otherFetch });
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
  } finally { await ui.cleanup(); }

  let settle, signal;
  const pendingFetch = async (_, init) => {
    signal = init.signal;
    return await new Promise(resolve => { settle = resolve; });
  };
  const pendingUi = await mount({ table: "videos", tableLabel: "動画", fetchFn: pendingFetch });
  try {
    await typeText(pendingUi, "id,title\n1,alpha");
    const button = [...pendingUi.host.querySelectorAll("button")].find(b => b.textContent.trim() === "サーバーで確認");
    await React.act(async () => { button.click(); });
    assert.ok(signal);
    assert.equal(signal.aborted, false);
    await pendingUi.rerender({ table: "events", tableLabel: "イベント", fetchFn: pendingFetch });
    assert.equal(signal.aborted, true);
    assert.equal(pendingUi.host.querySelectorAll("button")[1].disabled, true);
    await React.act(async () => settle(json(200, preview)));
    await flush();
    assert.doesNotMatch(pendingUi.host.innerHTML, /SECRET_PREVIEW_TOKEN|&lt;PRIVATE&gt;/);
  } finally { await pendingUi.cleanup(); }
});

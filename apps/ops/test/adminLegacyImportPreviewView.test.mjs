import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { AdminLegacyImportPreviewView } from "../.test-dist/apps/ops/src/routes/admin/AdminLegacyImportPreviewView.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/import",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const expires = () => Math.floor(Date.now() / 1000) + 3600;
const preview = () => ({
  ok: true, mode: "preview", preview_token: "private-token",
  plan_hash: "private-hash", expires_at: expires(), warnings: ["注意"],
});
const step = { ok: true, continuation_required: true,
  progress: { stage: "events", index: 1, completed: 1, total: 2 } };
const reply = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
async function flush() {
  await React.act(async () => { await new Promise(resolve => setImmediate(resolve)); });
}
async function mount(props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = async (next) => {
    await React.act(async () => root.render(React.createElement(AdminLegacyImportPreviewView, next)));
    await flush();
  };
  await render(props);
  return { host, render, cleanup: async () => {
    await React.act(async () => root.unmount());
    host.remove();
  }};
}
async function chooseFiles(ui, files) {
  const inp = ui.host.querySelector('input[type="file"]');
  Object.defineProperty(inp, "files", { configurable: true, value: files });
  await React.act(async () => inp.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
  await flush();
}
async function click(ui, label) {
  const button = [...ui.host.querySelectorAll("button")].find(el => el.textContent.trim() === label);
  assert.ok(button, "button missing: " + label);
  assert.equal(button.disabled, false, "button disabled: " + label);
  await React.act(async () => button.click());
  await flush();
}
const file = new File(["id,title\n1,Alpha"], "legacy.csv", { type: "text/csv" });

test("MIG-0737 U02: SSR and default UI cannot write or disclose credential", async () => {
  const html = renderToStaticMarkup(React.createElement(AdminLegacyImportPreviewView));
  assert.match(html, /書き込み操作は移行ゲート未完了/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /private-token|private-hash/);
  let calls = 0;
  const ui = await mount({ fetchFn: async () => { calls++; return reply(200, preview()); } });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    assert.equal(calls, 1);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.match(ui.host.textContent, /プレビュー済み/);
    assert.doesNotMatch(ui.host.innerHTML, /private-token|private-hash/);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U02: opt-in cannot apply without explicit confirmation", async () => {
  const calls = [];
  let confirms = 0;
  const fn = async (_, init) => {
    const mode = init.body.get("mode");
    calls.push(mode);
    return reply(200, mode === "preview" ? preview() : step);
  };
  const ui = await mount({
    fetchFn: fn, allowApply: true, confirmApply: () => { confirms++; return false; },
  });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    await click(ui, "確認して1ステップ反映");
    assert.equal(confirms, 1);
    assert.deepEqual(calls, ["preview"]);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, false);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U02: apply sends one step only; continuation requires another click", async () => {
  const requests = [];
  const fn = async (_, init) => {
    const form = init.body;
    requests.push([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]));
    return reply(200, form.get("mode") === "preview" ? preview() : step);
  };
  const ui = await mount({
    fetchFn: fn, allowApply: true, confirmApply: () => true,
  });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    await click(ui, "確認して1ステップ反映");
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], [
      ["mode", "apply"], ["preview_token", "private-token"], ["plan_hash", "private-hash"],
    ]);
    assert.match(ui.host.textContent, /反映進捗: 1\/2/);
    assert.match(ui.host.textContent, /続きの1ステップを承認して実行/);
    assert.equal(requests.length, 2);
    await click(ui, "続きの1ステップを承認して実行");
    assert.equal(requests.length, 3);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U02: network loss after apply never auto-retries", async () => {
  let calls = 0;
  const fn = async (_, init) => {
    calls++;
    if (init.body.get("mode") === "apply") throw new Error("lost response");
    return reply(200, preview());
  };
  const ui = await mount({ fetchFn: fn, allowApply: true, confirmApply: () => true });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    await click(ui, "確認して1ステップ反映");
    assert.equal(calls, 2);
    assert.match(ui.host.textContent, /自動再送は行いません/);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U02: file change invalidates preview and disables apply", async () => {
  const fn = async () => reply(200, preview());
  const ui = await mount({ fetchFn: fn, allowApply: true });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, false);
    await chooseFiles(ui, [new File(["x"], "different.json")]);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.doesNotMatch(ui.host.textContent, /プレビュー済み/);
  } finally { await ui.cleanup(); }
});

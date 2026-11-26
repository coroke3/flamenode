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
const committedPending = {
  ok: false, committed: true, kind: "committed_progress_pending", retryable: true,
  requires_repreview: false, plan_hash: "private-hash", attempt: 1,
  progress: { stage: "videos", index: 1, completed: 6, total: 7 },
  result: { complete: false }, message: "private-provider-canary",
};
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

test("MIG-0737 U02: committed 409/503 shows saved progress and locks ordinary apply without retry", async () => {
  for (const code of [409, 503]) {
    const requests = [];
    const fn = async (_, init) => {
      const mode = init.body.get("mode");
      requests.push(mode);
      return mode === "preview" ? reply(200, preview()) : reply(code, committedPending);
    };
    const ui = await mount({ fetchFn: fn, allowApply: true, confirmApply: () => true });
    try {
      await chooseFiles(ui, [file]);
      await click(ui, "サーバーでプレビュー");
      await click(ui, "確認して1ステップ反映");
      assert.match(ui.host.textContent, /ステップ保存済み（進捗復旧中）/);
      assert.match(ui.host.textContent, /反映進捗: 6\/7/);
      assert.match(ui.host.textContent, /進捗復旧を確認/);
      assert.doesNotMatch(ui.host.innerHTML, /private-provider-canary|private-token|private-hash/);
      assert.doesNotMatch(ui.host.textContent, /反映処理が終了|反映結果を確認できません/);
      const apply = ui.host.querySelectorAll("button")[1];
      assert.equal(apply.disabled, true);
      await React.act(async () => apply.click());
      await flush();
      assert.deepEqual(requests, ["preview", "apply"]);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U02: committed final step is recovery pending, not import completion", async () => {
  const fn = async (_, init) => init.body.get("mode") === "preview" ? reply(200, preview()) : reply(503, {
    ...committedPending, progress: { stage: "complete", index: 0, completed: 7, total: 7 },
    result: { complete: true },
  });
  const ui = await mount({ fetchFn: fn, allowApply: true, confirmApply: () => true });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    await click(ui, "確認して1ステップ反映");
    assert.match(ui.host.textContent, /ステップ保存済み（進捗復旧中）/);
    assert.match(ui.host.textContent, /反映進捗: 7\/7/);
    assert.doesNotMatch(ui.host.textContent, /反映処理が終了|インポート完了/);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U02: R2 progress failure preserves the latest committed step after a successful step", async () => {
  let applies = 0;
  const fn = async (_, init) => {
    if (init.body.get("mode") === "preview") return reply(200, preview());
    applies++;
    return applies === 1 ? reply(200, { ...step,
      progress: { stage: "videos", index: 0, completed: 5, total: 7 },
    }) : reply(409, committedPending);
  };
  const ui = await mount({ fetchFn: fn, allowApply: true, confirmApply: () => true });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    await click(ui, "確認して1ステップ反映");
    assert.match(ui.host.textContent, /反映進捗: 5\/7/);
    await click(ui, "続きの1ステップを承認して実行");
    assert.match(ui.host.textContent, /反映進捗: 6\/7/);
    assert.doesNotMatch(ui.host.textContent, /反映進捗: 5\/7|続きの1ステップを承認して実行/);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.equal(applies, 2);
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U02: ordinary or invalid 409/503 never claims saved progress", async () => {
  for (const [status, payload] of [[409, { ok: false, retryable: true }],
    [503, { ...committedPending, plan_hash: "other-plan" }],
    [409, { ...committedPending, committed: "true" }]]) {
    let applies = 0;
    const fn = async (_, init) => {
      if (init.body.get("mode") === "preview") return reply(200, preview());
      applies++;
      return reply(status, payload);
    };
    const ui = await mount({ fetchFn: fn, allowApply: true, confirmApply: () => true });
    try {
      await chooseFiles(ui, [file]);
      await click(ui, "サーバーでプレビュー");
      await click(ui, "確認して1ステップ反映");
      assert.match(ui.host.textContent, /反映結果を確認できません/);
      assert.doesNotMatch(ui.host.textContent, /ステップ保存済み|反映進捗/);
      assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
      assert.equal(applies, 1);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0737 U02: late committed progress cannot return after transport/session replacement", async () => {
  let release;
  let signal;
  const previous = async (_, init) => {
    if (init.body.get("mode") === "preview") return reply(200, preview());
    signal = init.signal;
    return new Promise(resolve => { release = resolve; });
  };
  let nextRequests = 0;
  const next = async () => { nextRequests++; return reply(200, preview()); };
  const ui = await mount({ fetchFn: previous, allowApply: true, confirmApply: () => true });
  try {
    await chooseFiles(ui, [file]);
    await click(ui, "サーバーでプレビュー");
    await click(ui, "確認して1ステップ反映");
    await ui.render({ fetchFn: next, allowApply: true });
    assert.equal(signal.aborted, true);
    await React.act(async () => release(reply(503, committedPending)));
    await flush();
    assert.doesNotMatch(ui.host.textContent, /ステップ保存済み|反映進捗|プレビュー済み/);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.equal(nextRequests, 0);
  } finally { await ui.cleanup(); }
});


async function changeRange(ui, name, value) {
  const input = ui.host.querySelector(`input[name="${name}"]`);
  assert.ok(input, "range input missing: " + name);
  assert.equal(input.disabled, false);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  await React.act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await flush();
}

test("MIG-0737 U02: manual inclusive ranges preserve RH-002 repeated-file order and blank endpoints", async () => {
  const requests = [];
  const second = new File(["id,title\\n2,Beta"], "second.csv", { type: "text/csv" });
  const ui = await mount({ fetchFn: async (_, init) => {
    requests.push(init.body);
    return reply(200, preview());
  }, allowApply: true });
  try {
    await chooseFiles(ui, [file, second]);
    await changeRange(ui, "range_start_0", "1");
    await changeRange(ui, "range_end_0", "2");
    await changeRange(ui, "range_end_1", "3");
    await click(ui, "サーバーでプレビュー");
    assert.equal(requests.length, 1);
    const form = requests[0];
    assert.deepEqual(form.getAll("files").map(f => f.name), ["legacy.csv", "second.csv"]);
    assert.deepEqual(["range_start_0", "range_end_0", "range_start_1", "range_end_1"].map(k => form.get(k)),
      ["1", "2", "", "3"]);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, false);
    await changeRange(ui, "range_end_0", "4");
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.match(ui.host.textContent, /入力が変更されたため、プレビューをやり直してください/);
    assert.doesNotMatch(ui.host.textContent, /プレビュー済み（期限/);
    await click(ui, "サーバーでプレビュー");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].get("range_end_0"), "4");
  } finally { await ui.cleanup(); }
});

test("MIG-0737 U02: invalid ranges cannot preview and new files reset old range indexes", async () => {
  let calls = 0;
  const ui = await mount({ fetchFn: async () => { calls++; return reply(200, preview()); }, allowApply: true });
  try {
    await chooseFiles(ui, [file]);
    await changeRange(ui, "range_start_0", "3");
    await changeRange(ui, "range_end_0", "2");
    assert.equal(ui.host.querySelectorAll("button")[0].disabled, true);
    assert.equal(ui.host.querySelectorAll("button")[1].disabled, true);
    assert.match(ui.host.textContent, /終了位置は開始位置以上/);
    assert.equal(calls, 0);
    await changeRange(ui, "range_end_0", "0");
    assert.equal(ui.host.querySelectorAll("button")[0].disabled, true);
    await changeRange(ui, "range_end_0", "4");
    assert.equal(ui.host.querySelectorAll("button")[0].disabled, false);
    await chooseFiles(ui, [new File(["id"], "other.csv")]);
    assert.equal(ui.host.querySelector('input[name="range_start_0"]').value, "");
    assert.equal(ui.host.querySelector('input[name="range_end_0"]').value, "");
    await click(ui, "サーバーでプレビュー");
    assert.equal(calls, 1);
  } finally { await ui.cleanup(); }
});

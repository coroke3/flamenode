import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminRulesPage } from "../.test-dist/apps/ops/src/routes/admin/Rules.js";

const CANARY = "PRIVATE_RULE_VERSION_CANARY";
const rules = {
  status: "any",
  items: [{
    id: "tv1", version_label: CANARY, status: "published", severity: "major",
    published_at: 1700000000, updated_at: 1700000000,
  }],
  currentPublished: { id: "tv1", version_label: CANARY },
  reacceptRequiredCount: 1,
  reacceptCountIsLowerBound: false,
};
const reply = (status, payload) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});

async function withRulesPage(fetchFn, exercise) {
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://flamenode.test/admin/rules",
    virtualConsole: new VirtualConsole(),
  });
  const saved = new Map();
  for (const [name, value] of [
    ["window", dom.window],
    ["document", dom.window.document],
    ["navigator", dom.window.navigator],
    ["FormData", dom.window.FormData],
    ["IS_REACT_ACT_ENVIRONMENT", true],
  ]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const target = dom.window.document.querySelector("#root");
  const root = createRoot(target);
  try {
    await React.act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: ["/admin/rules"] },
        React.createElement(Routes, null,
          React.createElement(Route, { path: "/admin/rules", element: React.createElement(AdminRulesPage, { fetchFn }) }))));
    });
    await exercise(target, dom.window);
  } finally {
    await React.act(async () => root.unmount());
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }
}

async function openConfirmedBroadcast(target, win) {
  assert.match(target.textContent, /PRIVATE_RULE_VERSION_CANARY/);
  const trigger = [...target.querySelectorAll("button")]
    .find((button) => button.textContent.includes("再同意通知 enqueue"));
  assert.ok(trigger, "published rule must show reaccept broadcast control");
  await React.act(async () => trigger.click());
  const dialog = target.querySelector('[role="alertdialog"]');
  assert.ok(dialog, "broadcast dialog mounted");
  const inputs = dialog.querySelectorAll("input");
  const confirm = inputs[1];
  assert.ok(confirm);
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
    setter.call(confirm, "TERMS");
    confirm.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  const submit = [...dialog.querySelectorAll("button")]
    .find((button) => button.textContent.includes("30 件 enqueue"));
  assert.ok(submit);
  assert.equal(submit.disabled, false);
  return submit;
}

test("SEC broadcast: 401 and 403 write responses immediately clear all private rules UI", async () => {
  for (const status of [401, 403]) {
    let writes = 0;
    await withRulesPage(async (path, init) => {
      if (init?.method === "GET") {
        assert.equal(path, "/api/admin-read/rules?status=any");
        return reply(200, rules);
      }
      writes++;
      assert.equal(init.method, "POST");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.cache, "no-store");
      assert.equal(path, "/api/admin/terms/tv1/reaccept-broadcast");
      return reply(status, { ok: false, redirect: "https://evil.example", message: "denied" });
    }, async (target, win) => {
      const submit = await openConfirmedBroadcast(target, win);
      await React.act(async () => submit.click());
      assert.equal(writes, 1);
      assert.match(target.textContent, /規約管理へのアクセスが終了しました/);
      assert.doesNotMatch(target.textContent, /PRIVATE_RULE_VERSION_CANARY/);
      assert.equal(target.querySelector('[role="alertdialog"]'), null);
      assert.equal(target.querySelectorAll("button, input, textarea, select").length, 0);
    });
  }
});

test("SEC broadcast: an unrelated HTTP 503 leaves the modal and draft retryable", async () => {
  let writes = 0;
  await withRulesPage(async (_path, init) => {
    if (init?.method === "GET") return reply(200, rules);
    writes++;
    return reply(503, { ok: false, message: "try again" });
  }, async (target, win) => {
    const submit = await openConfirmedBroadcast(target, win);
    await React.act(async () => submit.click());
    assert.equal(writes, 1);
    assert.ok(target.querySelector('[role="alertdialog"]'));
    assert.match(target.textContent, /PRIVATE_RULE_VERSION_CANARY/);
    assert.doesNotMatch(target.textContent, /規約管理へのアクセスが終了しました/);
  });
});

test("SEC broadcast: 403 revokes before a stalled JSON response body is parsed", async () => {
  let controller;
  await withRulesPage(async (_path, init) => {
    if (init?.method === "GET") return reply(200, rules);
    const body = new ReadableStream({ start(value) { controller = value; } });
    return new Response(body, {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }, async (target, win) => {
    const submit = await openConfirmedBroadcast(target, win);
    try {
      await React.act(async () => submit.click());
      assert.match(target.textContent, /規約管理へのアクセスが終了しました/);
      assert.equal(target.querySelector('[role="alertdialog"]'), null);
    } finally {
      controller?.enqueue(new TextEncoder().encode('{"ok":false}'));
      controller?.close();
    }
  });
});

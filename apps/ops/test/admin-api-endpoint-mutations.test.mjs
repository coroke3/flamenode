import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { AdminApiEndpointMutations } from
  "../.test-dist/apps/ops/src/routes/admin/ApiEndpointMutations.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/api-endpoints",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const data = {
  rows: [{
    id: "event/a", event_id: "event/a", event_title: "公開イベントA",
    public_api_enabled: 1, updated_at: 1760000000, created_at: 1760000000,
    event_visibility_status: "public",
  }],
  eventOptions: [
    { id: "event/a", title: "公開イベントA", enabled: 1 },
    { id: "event/b", title: "公開イベントB", enabled: 0 },
  ],
};
const delay = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { resolve, promise };
};
async function mount(element) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await React.act(async () => root.render(element));
  return { node, async close() { await React.act(async () => root.unmount()); node.remove(); } };
}

test("MIG-0727 U04: endpoint controls offer all public events, labelled as CURRENT", () => {
  const html = renderToStaticMarkup(React.createElement(AdminApiEndpointMutations, {
    data, api: { enable() {}, setActive() {} }, onSuccess() {},
  }));
  assert.match(html, /イベントAPIを有効化/);
  assert.match(html, /name="event_id"/);
  assert.match(html, /value="event\/b"/);
  assert.match(html, /value="event\/a"/);
  assert.match(html, /発行済み/);
  assert.match(html, /公開イベントA/);
  assert.match(html, /無効化/);
  assert.match(html, /disabled=""/);
});

test("MIG-0727 U04: activation requires an actual selected option; busy blocks repeat and triggers refresh", async () => {
  const waiting = delay(), requests = [], refreshed = [];
  const api = {
    enable: id => { requests.push(id); return waiting.promise; },
    setActive: async () => ({ ok: true }),
  };
  const ui = await mount(React.createElement(AdminApiEndpointMutations, {
    data, api, onSuccess: () => refreshed.push(true),
  }));
  try {
    const form = ui.node.querySelector("form");
    const select = form.querySelector("select");
    await React.act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(requests, []);
    await React.act(async () => {
      select.value = "event/b";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await React.act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(requests, ["event/b"]);
    assert.equal(form.querySelector('button[type="submit"]').disabled, true);
    await React.act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      waiting.resolve({ ok: true, message: "公開APIリンクを発行しました。" });
    });
    assert.deepEqual(requests, ["event/b"]);
    assert.deepEqual(refreshed, [true]);
    assert.match(ui.node.textContent, /公開APIリンクを発行しました/);
  } finally { await ui.close(); }
});

test("MIG-0727 U04: disable failures retain error state and never report successful mutation", async () => {
  let called = 0, refreshed = 0;
  const api = {
    enable: async () => ({ ok: true }),
    setActive: async (id, value) => {
      assert.equal(id, "event/a"); assert.equal(value, 0);
      called++;
      return { ok: false, message: "更新が競合したか監査記録に失敗しました。" };
    },
  };
  const ui = await mount(React.createElement(AdminApiEndpointMutations, {
    data, api, onSuccess: () => refreshed++,
  }));
  try {
    const disable = [...ui.node.querySelectorAll("button")].find(b => b.textContent === "無効化");
    await React.act(async () => disable.click());
    assert.equal(called, 1);
    assert.equal(refreshed, 0);
    assert.match(ui.node.querySelector('[role="alert"]').textContent, /更新が競合/);
  } finally { await ui.close(); }
});

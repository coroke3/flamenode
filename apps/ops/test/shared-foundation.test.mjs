import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { useApiResult } from "../.test-dist/apps/ops/src/routes/useApiResult.js";
import { NotFoundView } from "../.test-dist/apps/ops/src/routes/NotFoundView.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/manage",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const requests = [];
  const load = (signal) => {
    const request = deferred();
    requests.push({ ...request, signal });
    return request.promise;
  };
  const Probe = ({ item, refreshKey = 0 }) => {
    const result = useApiResult(load, item, refreshKey);
    return React.createElement("p", null,
      result.status === "ok" ? "ok:" + result.data.id : result.status);
  };
  const render = (item, refreshKey = 0) =>
    React.act(async () => { root.render(React.createElement(Probe, { item, refreshKey })); });
  const cleanup = () => React.act(async () => { root.unmount(); target.remove(); });
  return { target, requests, render, cleanup };
}

test("MIG-0707 U05b: initial load, silent same-key refresh, keep last good data on failure", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    assert.equal(ui.target.textContent, "loading");
    await React.act(async () => { ui.requests[0].resolve({ status: "ok", data: { id: "one" } }); });
    assert.equal(ui.target.textContent, "ok:one");

    await ui.render("a", 1);
    assert.equal(ui.target.textContent, "ok:one");
    assert.equal(ui.requests.length, 2);
    await React.act(async () => { ui.requests[1].resolve({ status: "unavailable" }); });
    assert.equal(ui.target.textContent, "ok:one");

    await ui.render("a", 2);
    await React.act(async () => { ui.requests[2].resolve({ status: "ok", data: { id: "two" } }); });
    assert.equal(ui.target.textContent, "ok:two");
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0707 U05b: changed key resets loading and aborts obsolete requests", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    await ui.render("b");
    assert.equal(ui.requests[0].signal.aborted, true);
    assert.equal(ui.target.textContent, "loading");
    await React.act(async () => { ui.requests[0].resolve({ status: "ok", data: { id: "private-a" } }); });
    assert.equal(ui.target.textContent, "loading");
    await React.act(async () => { ui.requests[1].resolve({ status: "ok", data: { id: "public-b" } }); });
    assert.equal(ui.target.textContent, "ok:public-b");
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0707 U05b: initial rejected fetch is unavailable; unmount aborts active request", async () => {
  const ui = setup();
  try {
    await ui.render("bad");
    await React.act(async () => { ui.requests[0].reject(new Error("offline")); });
    assert.equal(ui.target.textContent, "unavailable");
    await ui.render("next");
    assert.equal(ui.target.textContent, "loading");
    assert.equal(ui.requests[0].signal.aborted, true);
  } finally {
    const active = ui.requests.at(-1);
    await ui.cleanup();
    assert.equal(active.signal.aborted, true);
  }
});

test("MIG-0707 U05b: 404 mirrors CURRENT fixed EmptyState text, icon and root link", () => {
  const html = renderToStaticMarkup(React.createElement(NotFoundView));
  assert.match(html, /ページが見つかりません/);
  assert.match(html, /URL を確認するか、トップページから再度お探しください。/);
  assert.match(html, /href="\/"[^>]*>トップへ戻る<\/a>/);
  assert.match(html, /fn-empty-state empty-empty empty-tone-neutral/);
  assert.match(html, /<circle cx="12" cy="12" r="10"/);
});

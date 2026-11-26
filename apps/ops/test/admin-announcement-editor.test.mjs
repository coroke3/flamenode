import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router-dom";
import {
  AnnouncementForm, DeleteAnnouncementButton, AnnouncementCreatePage,
  announcementDatetimeLocal,
} from "../.test-dist/apps/ops/src/routes/admin/AnnouncementEditor.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/announcements",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "FormData", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const detail = {
  id: "anc/a", title: "重要なお知らせ", body: "Markdown本文",
  severity: "warning", target_audience: "creators", is_published: 1,
  publish_at: 1760000000, expire_at: 1760200000, updated_at: 1760000100,
};
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(MemoryRouter, null, element)));
  return { container, async close() { await React.act(async () => root.unmount()); container.remove(); } };
}

test("MIG-0727 U02b: CURRENT create/edit fields, JST dates and CAS snapshot are in SSR markup", () => {
  const api = { create: async () => ({ ok: true }), update: async () => ({ ok: true }) };
  const create = renderToStaticMarkup(React.createElement(AnnouncementForm, { mode: "create", api, onSaved() {} }));
  for (const name of ["title", "body", "severity", "target_audience", "is_published", "publish_at", "expire_at"]) {
    assert.match(create, new RegExp('name="' + name + '"'));
  }
  assert.doesNotMatch(create, /name="base_updated_at"/);
  assert.match(create, /maxLength="200"/i);
  assert.match(create, /maxLength="8000"/i);
  assert.match(create, /作成/);

  const edit = renderToStaticMarkup(React.createElement(AnnouncementForm, {
    mode: "edit", initial: detail, api, onSaved() {},
  }));
  assert.match(edit, /name="id"[^>]*value="anc\/a"/);
  assert.match(edit, /name="base_updated_at"[^>]*value="1760000100"/);
  assert.match(edit, /重要なお知らせ/);
  assert.match(edit, /Markdown本文/);
  assert.match(edit, /value="creators" selected=""/);
  assert.match(edit, /value="warning" selected=""/);
  assert.match(edit, /value="1" selected=""/);
  assert.equal(announcementDatetimeLocal(null), "");
  assert.equal(announcementDatetimeLocal(Number.NaN), "");
  assert.match(announcementDatetimeLocal(1760000000), /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  const page = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AnnouncementCreatePage, {
      fetchFn: async () => { throw new Error("SSR must not fetch"); },
    })));
  assert.match(page, /新規お知らせ/);
  assert.match(page, /お知らせ一覧へ/);
});

test("MIG-0727 U02b: create submit calls API once and blocks duplicate submissions while pending", async () => {
  const pending = deferred();
  const calls = [];
  const saved = [];
  const api = { create: raw => { calls.push(raw); return pending.promise; } };
  const ui = await mount(React.createElement(AnnouncementForm, {
    mode: "create", api, onSaved: id => saved.push(id),
  }));
  try {
    const form = ui.container.querySelector("form");
    form.querySelector('[name="title"]').value = "入力タイトル";
    form.querySelector('[name="body"]').value = "入力本文";
    await React.act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].title, "入力タイトル");
    assert.equal(calls[0].body, "入力本文");
    assert.equal(ui.container.querySelector('button[type="submit"]').disabled, true);
    await React.act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      pending.resolve({ ok: true, id: "anc_1" });
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(saved, ["anc_1"]);
    assert.match(ui.container.textContent, /保存しました/);
  } finally { await ui.close(); }
});

test("MIG-0727 U02b: stale edit propagates CAS and server conflict without optimistic navigation", async () => {
  let input;
  const saved = [];
  const api = { update: async (id, raw) => {
    input = { id, raw };
    return { ok: false, message: "他の操作で更新されています。再読み込みして確認してください。" };
  } };
  const ui = await mount(React.createElement(AnnouncementForm, {
    mode: "edit", initial: detail, api, onSaved: id => saved.push(id),
  }));
  try {
    await React.act(async () => {
      ui.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(input.id, detail.id);
    assert.equal(input.raw.base_updated_at, String(detail.updated_at));
    assert.equal(input.raw.id, detail.id);
    assert.deepEqual(saved, []);
    assert.match(ui.container.querySelector('[role="alert"]').textContent, /他の操作で更新されています/);
  } finally { await ui.close(); }
});

test("MIG-0727 U02b: destructive delete requires confirmation, cancel is non-mutating", async () => {
  let calls = 0, navigated = 0;
  const api = { delete: async id => { assert.equal(id, detail.id); calls++; return { ok: true }; } };
  const ui = await mount(React.createElement(DeleteAnnouncementButton, {
    id: detail.id, api, onDeleted: () => navigated++,
  }));
  try {
    const button = ui.container.querySelector('button.fn-btn-danger');
    await React.act(async () => button.click());
    assert.equal(ui.container.querySelector('[role="alertdialog"]') !== null, true);
    await React.act(async () => ui.container.querySelector('.confirm-footer button:first-child').click());
    assert.equal(calls, 0);
    await React.act(async () => button.click());
    await React.act(async () => ui.container.querySelector('.confirm-footer button:last-child').click());
    assert.equal(calls, 1);
    assert.equal(navigated, 1);
  } finally { await ui.close(); }
});

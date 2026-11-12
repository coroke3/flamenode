import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router-dom";
import {
  TermsForm, AdminRuleCreatePage,
} from "../.test-dist/apps/ops/src/routes/admin/TermsEditor.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/rules",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "FormData", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const draft = {
  id: "tv-123", version_label: "2026-11", body_markdown: "# テキスト",
  severity: "major", status: "draft",
};
const published = { ...draft, status: "published" };
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
async function mount(element) {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  await React.act(async () => root.render(element));
  return { target, async close() { await React.act(async () => root.unmount()); target.remove(); } };
}

test("MIG-0727 U03b: CURRENT draft field contract, max lengths and state-bound controls", () => {
  const api = {};
  const html = (mode, initial) => renderToStaticMarkup(
    React.createElement(TermsForm, { mode, initial, api, onSaved() {} }),
  );
  const create = html("create", { version_label: "2026-11", body_markdown: "# 本文", severity: "major" });
  for (const name of ["version_label", "body_markdown", "severity"]) {
    assert.match(create, new RegExp('name="' + name + '"'));
  }
  assert.match(create, /maxLength="80"/i);
  assert.match(create, /maxLength="40000"/i);
  assert.match(create, /下書き作成/);
  assert.doesNotMatch(create, /type="hidden" name="id"/);
  assert.doesNotMatch(create, /利用規約を公開/);

  const editable = html("edit", draft);
  assert.match(editable, /type="hidden" name="id" value="tv-123"/);
  assert.match(editable, /下書き保存/);
  assert.match(editable, /公開/);
  assert.doesNotMatch(editable, /アーカイブ/);

  const immutable = html("edit", published);
  assert.doesNotMatch(immutable, /type="submit"/);
  assert.match(immutable, /readOnly=""/);
  assert.match(immutable, /アーカイブ/);
  assert.doesNotMatch(immutable, /fn-btn-warning[^>]*>公開</);
  assert.match(html("edit", { ...draft, status: "archived" }), /状態のため編集不可/);
  const createPage = renderToStaticMarkup(
    React.createElement(MemoryRouter, null,
      React.createElement(AdminRuleCreatePage, {
        initial: { version_label: "2026-11", body_markdown: "# 本文", severity: "major" },
      })),
  );
  assert.match(createPage, /新規利用規約バージョン/);
  assert.match(createPage, /下書きとして保存/);
});

test("MIG-0727 U03b: publish requires explicit confirmation and cancelled dialog does not write", async () => {
  let calls = 0;
  const api = {
    publish: async id => { assert.equal(id, draft.id); calls++; return { ok: true, id }; },
  };
  const ui = await mount(React.createElement(TermsForm, {
    mode: "edit", initial: draft, api, onSaved() {},
  }));
  try {
    const show = () => [...ui.target.querySelectorAll("button")].find(b => b.textContent === "公開");
    await React.act(async () => show().click());
    assert.equal(calls, 0);
    assert.match(ui.target.querySelector('[role="alertdialog"]').textContent, /全ユーザーに再同意を要求/);
    await React.act(async () => ui.target.querySelector('.confirm-footer button:first-child').click());
    assert.equal(calls, 0);
    assert.equal(ui.target.querySelector('[role="alertdialog"]'), null);
    await React.act(async () => show().click());
    await React.act(async () => ui.target.querySelector('.confirm-footer button:last-child').click());
    assert.equal(calls, 1);
  } finally { await ui.close(); }
});

test("MIG-0727 U03b: draft save is single-flight and forwards all CURRENT input keys", async () => {
  const pending = deferred();
  const requests = [], saved = [];
  const api = { updateDraft: (id, raw) => {
    requests.push({ id, raw });
    return pending.promise;
  } };
  const ui = await mount(React.createElement(TermsForm, {
    mode: "edit", initial: draft, api, onSaved: id => saved.push(id),
  }));
  try {
    const form = ui.target.querySelector("form");
    await React.act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].id, draft.id);
    assert.equal(requests[0].raw.id, draft.id);
    assert.equal(requests[0].raw.version_label, draft.version_label);
    assert.equal(requests[0].raw.body_markdown, draft.body_markdown);
    assert.equal(requests[0].raw.severity, draft.severity);
    assert.equal(ui.target.querySelector('[type="submit"]').disabled, true);
    await React.act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      pending.resolve({ ok: true, id: draft.id });
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(saved, [draft.id]);
  } finally { await ui.close(); }
});

test("MIG-0727 U03b: archive requires confirmation; 409 error never claims success", async () => {
  let calls = 0, saved = 0;
  const api = { archive: async id => {
    assert.equal(id, published.id);
    calls++;
    return { ok: false, message: "更新が競合しました。" };
  } };
  const ui = await mount(React.createElement(TermsForm, {
    mode: "edit", initial: published, api, onSaved: () => saved++,
  }));
  try {
    const button = [...ui.target.querySelectorAll("button")].find(b => b.textContent === "アーカイブ");
    await React.act(async () => button.click());
    assert.equal(calls, 0);
    await React.act(async () => ui.target.querySelector('.confirm-footer button:last-child').click());
    assert.equal(calls, 1);
    assert.equal(saved, 0);
    assert.match(ui.target.querySelector('[role="alert"]').textContent, /更新が競合しました/);
  } finally { await ui.close(); }
});

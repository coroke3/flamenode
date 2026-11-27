import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router-dom";
import {
  TermsForm, AdminRuleCreatePage,
} from "../.test-dist/apps/ops/src/routes/admin/TermsEditor.js";
import { TermsReacceptBroadcastButton } from "../.test-dist/apps/ops/src/routes/admin/TermsReacceptBroadcastButton.js";
import {
  DEFAULT_TERMS_MARKDOWN, DEFAULT_TERMS_VERSION_LABEL,
} from "../.test-dist/apps/ops/src/routes/admin/defaultTerms.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/rules",
});
for (const key of ["window", "document", "navigator", "Element", "HTMLElement", "HTMLInputElement", "Node", "FormData", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

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

test("MIG-0727 T05/T06: TermsReacceptBroadcastButton enforces TERMS confirmation, carries cursor across batches, and blocks duplicate submits", async () => {
  const calls = [];
  let refreshes = 0;
  const pending = deferred();
  const api = {
    broadcast: (id, confirm, cursor, content) => {
      calls.push({ id, confirm, cursor, content });
      if (calls.length === 1) return pending.promise;
      return Promise.resolve({
        ok: true,
        enqueued: 12,
        cursor: "user-2",
        message: "2回目OK",
      });
    },
  };
  const ui = await mount(React.createElement(TermsReacceptBroadcastButton, {
    termsId: "tv-pub",
    versionLabel: "2026-11",
    affectedCount: 30,
    api,
    onSuccess: () => { refreshes++; },
  }));
  try {
    const trigger = ui.target.querySelector("button");
    assert.equal(trigger.disabled, false);
    await React.act(async () => trigger.click());
    const dialog = ui.target.querySelector('[role="alertdialog"]');
    assert.ok(dialog);
    const submitBtn = [...dialog.querySelectorAll("button")].find(b => b.textContent.includes("enqueue"));
    const inputs = dialog.querySelectorAll("input");
    const cursorInput = inputs[0];
    const confirmInput = inputs[1];
    assert.equal(submitBtn.disabled, true, "T05: disabled until TERMS is entered");

    // Wrong confirmation string keeps submit disabled
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      setter.call(confirmInput, "TERM");
      confirmInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(submitBtn.disabled, true);
    assert.equal(calls.length, 0);

    // Exact TERMS enables submit
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      setter.call(confirmInput, "TERMS");
      confirmInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(submitBtn.disabled, false);

    // First submit + duplicate click while busy
    await React.act(async () => submitBtn.click());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cursor, "");
    await React.act(async () => submitBtn.click());
    assert.equal(calls.length, 1, "busy blocks duplicate dispatch");

    await React.act(async () => {
      pending.resolve({ ok: true, enqueued: 30, cursor: "user-1", message: "1回目OK", warning: "要確認" });
    });
    assert.equal(refreshes, 1);
    assert.equal(cursorInput.value, "user-1");
    assert.match(dialog.textContent, /合計 enqueued: 30/);
    assert.match(dialog.querySelector('[role="alert"]').textContent, /要確認/);

    // T06: Second submit sends previous cursor "user-1"
    await React.act(async () => submitBtn.click());
    assert.equal(calls.length, 2);
    assert.equal(calls[1].cursor, "user-1");
    assert.match(dialog.textContent, /合計 enqueued: 42/);
    assert.equal(cursorInput.value, "user-2");
    assert.equal(refreshes, 2);
  } finally { await ui.close(); }
});

test("MIG-0727 U03: AdminRuleCreatePage defaults match CURRENT defaultTerms.ts", async () => {
  const currentSrc = await readFile(new URL("../../../src/lib/terms/defaultTerms.ts", import.meta.url), "utf8");
  assert.ok(currentSrc.includes(DEFAULT_TERMS_VERSION_LABEL));
  assert.ok(currentSrc.includes(DEFAULT_TERMS_MARKDOWN));
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminRuleCreatePage)));
  assert.match(html, new RegExp(DEFAULT_TERMS_VERSION_LABEL));
  assert.match(html, /FlameNode 利用規約/);
  assert.match(html, /value="major" selected=""/);
});

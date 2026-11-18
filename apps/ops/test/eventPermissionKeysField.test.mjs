import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { GENERAL_EDITABLE_FIELD_KEYS } from "@flamenode/domain/video";
import { PermissionKeysField } from "../.test-dist/apps/ops/src/components/event/PermissionKeysField.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/admin/events/new" });
for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function staticField(value, allowUserVideoEdits = 1, disabled = false) {
  const html = renderToStaticMarkup(React.createElement(PermissionKeysField, {
    name: "user_video_edit_permission_keys_json", defaultValue: value,
    allowUserVideoEdits, disabled,
  }));
  return new JSDOM(html).window.document;
}

async function mountedField(value, allowUserVideoEdits = 1, disabled = false) {
  const rootNode = document.createElement("div");
  document.body.append(rootNode);
  const root = createRoot(rootNode);
  await React.act(async () => root.render(React.createElement(PermissionKeysField, {
    name: "permissions", defaultValue: value, allowUserVideoEdits, disabled,
  })));
  return {
    node: rootNode,
    async close() { await React.act(async () => root.unmount()); rootNode.remove(); },
  };
}

test("MIG-0721 U01b-2: untouched legacy grants retain exact bytes and show safe effective state", () => {
  const legacy = '["title"]';
  const doc = staticField(legacy);
  assert.equal(doc.querySelector('[type="hidden"]').getAttribute("name"), "user_video_edit_permission_keys_json");
  assert.equal(doc.querySelector('[type="hidden"]').getAttribute("value"), legacy);
  assert.equal(doc.querySelector('select[aria-label="タイトル policy"]').value, "allow");
  assert.equal(doc.querySelector('select[aria-label="YouTube URL policy"]').value, "deny");
  assert.equal(doc.querySelectorAll("select").length, GENERAL_EDITABLE_FIELD_KEYS.length);
  const malformed = staticField("{malformed");
  assert.equal(malformed.querySelector('select[aria-label="タイトル policy"]').value, "deny",
    "legacy allow=1 with an unknown document must not broaden permissions");
});

test("MIG-0721 U01b-2: v2 fallback deny is preserved for omitted fields", () => {
  const raw = JSON.stringify({ version: 2, fallback: "deny", allow: ["title"], deny: [], inherit: [] });
  const doc = staticField(raw);
  assert.equal(doc.querySelector('[type="hidden"]').getAttribute("value"), raw);
  assert.equal(doc.querySelector('select[aria-label="タイトル policy"]').value, "allow");
  assert.equal(doc.querySelector('select[aria-label="YouTube URL policy"]').value, "deny");
  assert.equal(doc.querySelector('select[aria-label="プロフィール文 policy"]').value, "deny");
  const inherit = staticField(null, 0);
  assert.equal(inherit.querySelector('select[aria-label="タイトル policy"]').value, "inherit");
  assert.equal(inherit.querySelector('[type="hidden"]').getAttribute("value"), "");
});

test("MIG-0721 U01b-2: one bulk edit serializes explicit v2 states and preserves field order", async () => {
  const ui = await mountedField('["title"]');
  try {
    const hidden = ui.node.querySelector('input[type="hidden"]');
    const buttons = [...ui.node.querySelectorAll('button')];
    const allow = buttons.find(b => b.textContent.includes("すべて許可"));
    const inherit = buttons.find(b => b.textContent.includes("すべて継承"));
    assert.ok(allow); assert.ok(inherit);
    assert.equal(hidden.value, '["title"]');
    await React.act(async () => allow.click());
    const full = JSON.parse(hidden.value);
    assert.equal(full.version, 2);
    assert.equal(full.fallback, "inherit");
    assert.deepEqual(full.allow, [...GENERAL_EDITABLE_FIELD_KEYS]);
    assert.deepEqual(full.deny, []);
    assert.deepEqual(full.inherit, []);
    await React.act(async () => inherit.click());
    const next = JSON.parse(hidden.value);
    assert.deepEqual(next.allow, []);
    assert.deepEqual(next.inherit, [...GENERAL_EDITABLE_FIELD_KEYS]);
  } finally { await ui.close(); }
});

test("MIG-0721 U01b-2: disabled editor is non-mutating and submits the original policy", async () => {
  const raw = JSON.stringify({ version: 2, fallback: "deny", allow: ["title"], deny: [], inherit: [] });
  const ui = await mountedField(raw, 1, true);
  try {
    const hidden = ui.node.querySelector('input[type="hidden"]');
    const buttons = [...ui.node.querySelectorAll('button')];
    assert.equal(hidden.value, raw);
    assert.equal(buttons.length, 2);
    assert.equal([...ui.node.querySelectorAll('select')].every(s => s.disabled), true);
    assert.equal(buttons.every(b => b.disabled), true);
    await React.act(async () => buttons[0].click());
    assert.equal(hidden.value, raw);
  } finally { await ui.close(); }
});

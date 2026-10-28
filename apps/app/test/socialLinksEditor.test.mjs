// MIG-0712 U02/T02: social links editor remains a pure controlled form widget.
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { dom } from "./helpers.mjs";

const { SocialLinksEditor } = await import("../.test-dist/apps/app/src/components/shared/SocialLinksEditor.js");

const mount = async (props) => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(SocialLinksEditor, props)); });
  return { container, unmount: () => act(async () => root.unmount()) };
};

test("MIG-0712 T02: initial SNS JSON is carried into hidden form value and external edits notify consumer", async () => {
  const changes = [];
  const initialValue = JSON.stringify([{ type: "X", url: "https://x.com/creator" }]);
  const m = await mount({ initialValue, onValueChange: (value) => changes.push(value) });
  try {
    assert.equal(m.container.querySelectorAll('input[inputmode="url"]').length, 1);
    assert.equal(m.container.querySelector('input[name="other_social_links"]').value, initialValue);
    assert.equal(m.container.querySelector("select").value, "X");
    assert.ok(changes.includes(initialValue));
    assert.match(m.container.textContent, /SNS \/ 外部リンク/);
  } finally { await m.unmount(); }
});

test("MIG-0712 T02: add/remove is bounded to 8 rows and preserves at least one empty row", async () => {
  const m = await mount({ initialValue: null });
  try {
    const add = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("追加"));
    assert.ok(add);
    for (let i = 1; i < 8; i++) await act(async () => { add.click(); });
    assert.equal(m.container.querySelectorAll('input[inputmode="url"]').length, 8);
    assert.equal(add.disabled, true, "eight entries must be the maximum");
    const remove = [...m.container.querySelectorAll('button[aria-label="SNSリンクを削除"]')];
    assert.equal(remove.length, 8);
    await act(async () => { remove[0].click(); });
    assert.equal(m.container.querySelectorAll('input[inputmode="url"]').length, 7);
    assert.equal(add.disabled, false);
    for (let i = 0; i < 7; i++) {
      const button = m.container.querySelector('button[aria-label="SNSリンクを削除"]');
      await act(async () => { button.click(); });
    }
    assert.equal(m.container.querySelectorAll('input[inputmode="url"]').length, 1);
    assert.equal(m.container.querySelector('input[name="other_social_links"]').value, "");
  } finally { await m.unmount(); }
});

test("MIG-0712 T02: disabled widget cannot add, remove, or edit links", async () => {
  const m = await mount({ initialValue: "X: https://x.com/creator", disabled: true });
  try {
    const buttons = [...m.container.querySelectorAll("button")];
    assert.ok(buttons.every(b => b.disabled));
    assert.ok([...m.container.querySelectorAll("input, select")].filter(x => x.type !== "hidden").every(x => x.disabled));
    assert.equal(m.container.querySelectorAll('input[inputmode="url"]').length, 1);
  } finally { await m.unmount(); }
});

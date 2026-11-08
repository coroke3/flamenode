// MIG-0712 U02/T02: shared ConfirmDialog (D-16-4) keeps CURRENT behavior with cdlg-* classes.
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { dom } from "./helpers.mjs";

const { ConfirmDialog } = await import("../.test-dist/apps/app/src/components/shared/ConfirmDialog.js");

const mount = async (props) => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(ConfirmDialog, props)));
  return {
    container,
    rerender: (p) => act(async () => root.render(React.createElement(ConfirmDialog, p))),
    unmount: async () => { await act(async () => root.unmount()); container.remove(); },
  };
};

test("MIG-0712 ConfirmDialog: closed renders nothing", async () => {
  const m = await mount({ open: false, title: "t", onConfirm() {}, onCancel() {} });
  try { assert.equal(m.container.innerHTML, ""); } finally { await m.unmount(); }
});

test("MIG-0712 ConfirmDialog: alertdialog semantics, cdlg classes, confirm and cancel", async () => {
  let confirmed = 0, cancelled = 0;
  const m = await mount({ open: true, title: "削除", message: "本当に?", tone: "danger", onConfirm: () => confirmed++, onCancel: () => cancelled++ });
  try {
    const dlg = m.container.querySelector('[role="alertdialog"][aria-modal="true"]');
    assert.ok(dlg);
    assert.ok(dlg.classList.contains("cdlg-dialog"));
    assert.ok(m.container.querySelector(".cdlg-backdrop"));
    assert.ok(dlg.getAttribute("aria-describedby"));
    const buttons = [...m.container.querySelectorAll(".cdlg-footer button")];
    assert.equal(buttons[1].className, "fn-btn fn-btn-danger");
    await act(async () => buttons[1].click());
    await act(async () => buttons[0].click());
    assert.equal(confirmed, 1);
    assert.equal(cancelled, 1);
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })); });
    assert.equal(cancelled, 2);
  } finally { await m.unmount(); }
});

test("MIG-0712 ConfirmDialog: expectedText gates confirm; busy disables Escape and buttons", async () => {
  let confirmed = 0, cancelled = 0;
  const base = { open: true, title: "t", expectedText: "DELETE", onConfirm: () => confirmed++, onCancel: () => cancelled++ };
  const m = await mount(base);
  try {
    const confirm = () => m.container.querySelectorAll(".cdlg-footer button")[1];
    assert.equal(confirm().disabled, true);
    assert.equal(m.container.querySelector(".cdlg-confirmation code").textContent, "DELETE");
    const input = m.container.querySelector(".cdlg-confirmation input");
    // helpers.mjs imports react-dom before the jsdom globals exist, so React's native "input" delegation is off here;
    // drive the input through its React onChange prop instead.
    const type = async (v) => act(async () => {
      const propsKey = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
      input[propsKey].onChange({ target: { value: v } });
    });
    await type("DELET");
    assert.equal(confirm().disabled, true);
    await type("DELETE");
    assert.equal(confirm().disabled, false);
    await act(async () => confirm().click());
    assert.equal(confirmed, 1);
    await m.rerender({ ...base, busy: true });
    assert.equal(m.container.querySelectorAll(".cdlg-footer button")[0].disabled, true);
    assert.equal(confirm().disabled, true);
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })); });
    assert.equal(cancelled, 0);
    assert.match(confirm().textContent, /処理中/);
    assert.equal(confirmed, 1);
  } finally { await m.unmount(); }
});

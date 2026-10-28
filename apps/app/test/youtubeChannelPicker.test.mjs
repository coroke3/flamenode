// MIG-0712 U02/T02: shared YouTube channel picker remains a network-free form.
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { dom } from "./helpers.mjs";

const { YoutubeChannelPicker } = await import("../.test-dist/apps/app/src/components/shared/YoutubeChannelPicker.js");

const mount = async (props) => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(YoutubeChannelPicker, props)));
  return { container, unmount: () => act(async () => root.unmount()) };
};

test("MIG-0712: candidate channel selection updates hidden form field and calls onValueChange", async () => {
  const changes = [];
  const value = "https://www.youtube.com/@creator";
  const next = "https://www.youtube.com/channel/UC123";
  const m = await mount({ defaultValue: value, candidates: [value, next], onValueChange: v => changes.push(v) });
  try {
    assert.equal(m.container.querySelector('input[type="hidden"]').value, value);
    assert.match(m.container.textContent, /youtube.com\/@creator/);
    const edit = [...m.container.querySelectorAll("button")].find(x => x.textContent.includes("変更"));
    await act(async () => edit.click());
    assert.ok(m.container.querySelector('[role="dialog"][aria-modal="true"]'));
    const select = [...m.container.querySelectorAll("button.ychan-candidateButton")].find(x => x.textContent.includes("UC123"));
    assert.ok(select);
    await act(async () => select.click());
    assert.deepEqual(changes, [next]);
    assert.equal(m.container.querySelector('input[type="hidden"]').value, next);
    assert.equal(m.container.querySelector('[role="dialog"]'), null);
  } finally { await m.unmount(); }
});

test("MIG-0712: unset channel uses URL input mode; invalid state is not saved; blank clears", async () => {
  const changes = [];
  const m = await mount({ defaultValue: null, candidates: [], onValueChange: v => changes.push(v) });
  try {
    assert.match(m.container.textContent, /未設定/);
    const edit = [...m.container.querySelectorAll("button")].find(x => x.textContent.includes("設定"));
    await act(async () => edit.click());
    assert.ok(m.container.querySelector('[role="dialog"]'));
    assert.equal(m.container.querySelector('input[type="url"]').value, "");
    const clear = [...m.container.querySelectorAll("button")].find(x => x.textContent.includes("未設定にする"));
    await act(async () => clear.click());
    assert.deepEqual(changes, [""]);
    assert.equal(m.container.querySelector('[role="dialog"]'), null);
  } finally { await m.unmount(); }
});

test("MIG-0712: disabled picker has no interactive controls", async () => {
  const m = await mount({ defaultValue: null, candidates: [], disabled: true });
  try {
    assert.ok([...m.container.querySelectorAll("button")].every(b => b.disabled));
    assert.equal(m.container.querySelector('[role="dialog"]'), null);
  } finally { await m.unmount(); }
});

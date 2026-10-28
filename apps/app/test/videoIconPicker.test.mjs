// MIG-0712 U02/T04: icon mode and crop boundary are exercised without upload/network access.
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { dom } from "./helpers.mjs";

const { VideoIconPicker } = await import("../.test-dist/apps/app/src/components/forms/VideoIconPicker.js");
const { SquareIconEditor } = await import("../.test-dist/apps/app/src/components/shared/SquareIconEditor.js");
const { SquareIconEditorBoundary } = await import("../.test-dist/apps/app/src/components/shared/SquareIconEditorBoundary.js");
const codec = await import("../.test-dist/apps/app/src/lib/squareIconEncode.js");

const u1 = "https://cdn.example/icon-1.png";
const u2 = "https://cdn.example/icon-2.png";
const mount = async (props) => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(VideoIconPicker, props)));
  return { container, unmount: () => act(async () => root.unmount()) };
};
const hidden = (node, name) => node.querySelector(`input[type="hidden"][name="${name}"]`)?.value;

test("MIG-0712 U02 T04: new form candidate and no-icon choice preserve hidden mode and URL", async () => {
  const calls = [];
  const m = await mount({ candidates: [u1, u2], initialIconUrl: u1, onChange: v => calls.push(v) });
  try {
    assert.equal(hidden(m.container, "icon_mode"), "existing");
    assert.equal(hidden(m.container, "icon_url"), u1);
    const candidates = [...m.container.querySelectorAll('button[aria-label="このアイコンを選択"]')];
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].getAttribute("aria-pressed"), "true");
    await act(async () => { candidates[1].click(); });
    assert.equal(hidden(m.container, "icon_mode"), "existing");
    assert.equal(hidden(m.container, "icon_url"), u2);
    assert.deepEqual(calls, [u2]);
    const clear = m.container.querySelector('button[aria-label="アイコンを指定しない"]');
    await act(async () => { clear.click(); });
    assert.equal(hidden(m.container, "icon_mode"), "none");
    assert.equal(hidden(m.container, "icon_url"), "");
    assert.deepEqual(calls, [u2, ""]);
  } finally { await m.unmount(); }
});

test("MIG-0712 U02 T04: editing existing icon starts in keep and choosing another emits existing", async () => {
  const m = await mount({ candidates: [u1, u2], initialIconUrl: u1, persistedIconUrl: u1, isEdit: true });
  try {
    assert.equal(hidden(m.container, "icon_mode"), "keep");
    assert.equal(hidden(m.container, "icon_url"), "");
    const buttons = [...m.container.querySelectorAll('button[aria-label="このアイコンを選択"]')];
    await act(async () => { buttons[1].click(); });
    assert.equal(hidden(m.container, "icon_mode"), "existing");
    assert.equal(hidden(m.container, "icon_url"), u2);
    await act(async () => { buttons[0].click(); });
    assert.equal(hidden(m.container, "icon_mode"), "keep");
    assert.equal(hidden(m.container, "icon_url"), "");
  } finally { await m.unmount(); }
});

test("MIG-0712 U02 T04: upload tab opens SquareIconEditor without posting or image conversion", async () => {
  const m = await mount({ candidates: [], isEdit: false });
  try {
    assert.match(m.container.textContent, /まだ候補がありません/);
    const upload = m.container.querySelector("#video-icon-tab-upload");
    assert.ok(upload);
    await act(async () => { upload.click(); });
    assert.equal(upload.getAttribute("aria-selected"), "true");
    assert.ok(m.container.querySelector("#video-icon-tabpanel-upload"));
    assert.match(m.container.textContent, /画像を選ぶ/);
    assert.equal(hidden(m.container, "icon_mode"), "none", "mode changes only when crop confirmed");
    assert.equal(m.container.querySelector('input[name="icon_file"]'), null);
  } finally { await m.unmount(); }
});

test("MIG-0712 U02 T04: disabled icon picker blocks candidate, tab and crop actions", async () => {
  const m = await mount({ candidates: [u1], initialIconUrl: u1, disabled: true });
  try {
    assert.ok([...m.container.querySelectorAll('button')].every(b => b.disabled));
    assert.ok([...m.container.querySelectorAll('input[type="file"]')].every(i => i.disabled));
    assert.equal(hidden(m.container, "icon_mode"), "existing");
  } finally { await m.unmount(); }
});

test("MIG-0712 U02 T04: crop validation rejects invalid images and bounds transforms", () => {
  assert.equal(codec.isValidBitmap({ width: 256, height: 256 }), true);
  assert.equal(codec.isValidBitmap({ width: 0, height: 256 }), false);
  assert.equal(codec.isValidBitmap({ width: Infinity, height: 16 }), false);
  assert.deepEqual(codec.sanitizeTransform({ offsetX: Infinity, offsetY: NaN, scale: 99 }), { offsetX: 0, offsetY: 0, scale: 3 });
  assert.deepEqual(codec.sanitizeTransform({ offsetX: -3, offsetY: 5, scale: -5 }), { offsetX: -3, offsetY: 5, scale: 1 });
  assert.equal(codec.isIconPreviewError(codec.createIconPreviewError()), true);
});

test("MIG-0712 U02 T04: editor and boundary display safe upload and selection shells", () => {
  const editor = renderToStaticMarkup(React.createElement(SquareIconEditor, { onUseImage: async () => ({ ok: true }) }));
  assert.match(editor, /sqicon-root/);
  assert.match(editor, /画像を選ぶ/);
  const boundary = renderToStaticMarkup(React.createElement(SquareIconEditorBoundary, null, React.createElement("div", null, "表示可")));
  assert.match(boundary, /表示可/);
});

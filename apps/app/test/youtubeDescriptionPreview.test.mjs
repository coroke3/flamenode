// MIG-0712 U02: CURRENT YouTube description preview UI from the compiled SPA port.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { dom } from "./helpers.mjs";

const { YoutubeDescriptionPreview } = await import("../.test-dist/apps/app/src/components/forms/YoutubeDescriptionPreview.js");

const props = (over = {}) => ({
  template: "{{event_title}} / {{title}}",
  eventTitle: "春イベント",
  context: { event_id: "ev1", event_title: "春イベント", title: "First Light" },
  ...over,
});

test("MIG-0712 U02 T03: preview preserves template text, section, accessibility and current CSS classes", () => {
  const html = renderToStaticMarkup(React.createElement(YoutubeDescriptionPreview, props()));
  assert.match(html, /YouTube概要欄（コピー用）/);
  assert.match(html, /イベントテンプレート: 春イベント/);
  assert.match(html, /class="ydesc-panel"/);
  assert.match(html, /class="fn-input ydesc-textarea"/);
  assert.match(html, /春イベント \/ First Light/);
  assert.match(html, /自動生成/);
  assert.match(html, /aria-label="春イベント のYouTube概要欄"/);
});

test("MIG-0712 U02 T03: missing dynamic data and unknown template keys remain visible as warnings", () => {
  const html = renderToStaticMarkup(React.createElement(YoutubeDescriptionPreview, props({
    template: "{{title}} {{unknown_variable}}",
    context: { event_id: "ev1", title: "" },
  })));
  assert.match(html, /テンプレートで使う情報に未入力があります/);
  assert.match(html, /作品タイトルが未入力です/);
  assert.match(html, /テンプレートに未登録の変数があります/);
  assert.match(html, /unknown_variable/);
  assert.match(html, /role="alert"/);
});

test("MIG-0712 U02 T03: copy uses injected browser clipboard and displays a success status", async () => {
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  const copied = [];
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (s) => { copied.push(s); } },
  });
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(YoutubeDescriptionPreview, props())));
    const copy = [...container.querySelectorAll("button")].find(b => b.textContent.includes("概要欄をコピー"));
    assert.ok(copy);
    await act(async () => { copy.click(); await Promise.resolve(); });
    assert.deepEqual(copied, ["春イベント / First Light"]);
    assert.match(container.textContent, /コピーしました/);
    assert.match(container.textContent, /YouTubeの概要欄へ貼り付けできます/);
  } finally {
    await act(async () => root.unmount());
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  }
});

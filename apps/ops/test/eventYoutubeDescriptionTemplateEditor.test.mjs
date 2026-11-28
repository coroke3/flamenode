// MIG-0721: isolated CURRENT editor parity; responsive browser acceptance remains pending.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { YoutubeDescriptionTemplateEditor as Editor } from "../.test-dist/apps/ops/src/components/event/YoutubeDescriptionTemplateEditor.js";
import { youtubeTemplateEditorStyles as styles, youtubeTemplateEditorCss as css } from "../.test-dist/apps/ops/src/components/event/youtubeDescriptionTemplateEditorStyles.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const props = { eventTitle: "試写会", dynamicVariables: [{ key: "custom_answer:favorite_cut", label: "好きな演出", sampleValue: "カメラワーク" }] };
const button = (node, label) => {
  const found = [...node.querySelectorAll("button")].find(b => b.textContent.trim() === label);
  assert.ok(found, label);
  return found;
};

test("CURRENT source and CSS declarations are preserved except explicit adapters", () => {
  let actual = read("../src/components/event/YoutubeDescriptionTemplateEditor.tsx");
  for (const [old, next] of [["    <div className={styles.root}>\n","    <div className={styles.root}>\n      <style>{youtubeTemplateEditorCss}</style>\n"],["from \"@/lib/utils/clipboard\";","from \"../../lib/event/clipboard.js\";"],["from \"@/lib/event/youtubeDescriptionTemplate\";","from \"../../lib/event/youtubeDescriptionTemplate.js\";"],["import styles from \"./YoutubeDescriptionTemplateEditor.module.css\";","import { youtubeTemplateEditorStyles as styles, youtubeTemplateEditorCss } from \"./youtubeDescriptionTemplateEditorStyles.js\";"],["\"use client\";\n\n","// Port of CURRENT src/components/admin/YoutubeDescriptionTemplateEditor.tsx (MIG-0721). Same output; scoped CSS adaptation.\n"]]) actual = actual.replace(next, old);
  assert.equal(actual, read("../../../src/components/admin/YoutubeDescriptionTemplateEditor.tsx"));
  const reverse = new Map(Object.entries(styles).map(([key, value]) => [value, key]));
  assert.equal(reverse.size, 21);
  assert.equal(css.replace(/\.([A-Za-z]\w*)/g, (_, value) => {
    assert.ok(reverse.has(value), value);
    return "." + reverse.get(value);
  }), read("../../../src/components/admin/YoutubeDescriptionTemplateEditor.module.css"));
});

test("SSR preserves form field, dynamic token, preview and unknown-variable warning", () => {
  const value = "{{event_title}} / {{custom_answer:favorite_cut}} / {{unknown_token}}";
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(Editor, { ...props, value, onChange() {} })));
  try {
    const doc = dom.window.document;
    const field = doc.querySelector("textarea");
    assert.equal(field.name, "youtube_description_template");
    assert.equal(field.id, "youtube_description_template");
    assert.equal(field.maxLength, 10000);
    assert.equal(field.value, value);
    assert.equal(doc.querySelector("label").htmlFor, field.id);
    assert.ok(doc.querySelector('button[title="{{custom_answer:favorite_cut}}"]'));
    assert.equal(doc.querySelector("pre").textContent, "試写会 / カメラワーク / ");
    assert.match(doc.querySelector('[role="alert"]').textContent, /unknown_token/);
    assert.ok([...doc.querySelectorAll("button")].every(b => b.type === "button"));
  } finally { dom.window.close(); }
});

test("disabled editor prevents mutations but retains CURRENT preview-copy access", () => {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(Editor, { value: "{{title}}", disabled: true, onChange() {} })));
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector("textarea").disabled, true);
    const preview = button(doc, "出力例をコピー");
    assert.equal(preview.disabled, false);
    assert.ok([...doc.querySelectorAll("button")].filter(b => b !== preview).every(b => b.disabled));
    assert.equal(doc.querySelector("pre").textContent, "Sample Movie");
  } finally { dom.window.close(); }
});

async function withEditor(initial, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://flamenode.test/admin/events/new", pretendToBeVisual: true });
  const keys = ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"];
  const prev = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : dom.window[key] });
  const frames = [];
  dom.window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  const node = dom.window.document.getElementById("root");
  const root = createRoot(node);
  const changes = [];
  function Wrapper() {
    const [value, setValue] = React.useState(initial);
    return React.createElement(Editor, { ...props, value, onChange(next) { changes.push(next); setValue(next); } });
  }
  try {
    await React.act(async () => root.render(React.createElement(Wrapper)));
    await run({ dom, node, changes, frames });
  } finally {
    try { await React.act(async () => root.unmount()); }
    finally {
      for (const [key, descriptor] of prev) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  }
}

test("variable insertion replaces only selected text and retains suffix and caret", async () => {
  await withEditor("AoldB", async ({ node, changes, frames }) => {
    const field = node.querySelector("textarea");
    field.setSelectionRange(1, 4);
    await React.act(async () => node.querySelector('button[title="{{event_title}}"]').click());
    assert.deepEqual(changes, ["A{{event_title}}B"]);
    assert.equal(field.value, "A{{event_title}}B");
    assert.equal(node.querySelector("pre").textContent, "A試写会B");
    assert.equal(frames.length, 1);
    // Avoid React/jsdom focus-event polyfill interference in this caret test.
    let focused = false;
    field.focus = () => { focused = true; };
    frames.shift()(0);
    assert.equal(focused, true);
    assert.equal(field.selectionStart, "A{{event_title}}".length);
    assert.equal(field.selectionEnd, field.selectionStart);
  });
});

test("over-limit insertion does not alter existing text and announces warning", async () => {
  const original = "x".repeat(10000);
  await withEditor(original, async ({ node, changes, frames }) => {
    const field = node.querySelector("textarea");
    field.setSelectionRange(1, 1);
    await React.act(async () => node.querySelector('button[title="{{event_title}}"]').click());
    assert.deepEqual(changes, []);
    assert.equal(field.value, original);
    assert.match(node.querySelector('[role="status"]').textContent, /既存の本文は変更していません/);
    assert.equal(frames.length, 0);
  });
});

test("preset and clear respect confirmation and preserve cancelled content", async () => {
  await withEditor("残す本文", async ({ dom, node, changes }) => {
    const field = node.querySelector("textarea");
    let accept = false;
    let asked = 0;
    dom.window.confirm = () => { asked++; return accept; };
    await React.act(async () => button(node, "シンプル").click());
    await React.act(async () => button(node, "クリア").click());
    assert.deepEqual(changes, []);
    assert.equal(field.value, "残す本文");
    assert.equal(asked, 2);
    accept = true;
    await React.act(async () => button(node, "シンプル").click());
    assert.match(field.value, /^\{\{title\}\}/);
    await React.act(async () => button(node, "クリア").click());
    assert.equal(field.value, "");
    assert.equal(changes.length, 2);
  });
});

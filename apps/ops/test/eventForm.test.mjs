// MIG-0721 U01: unmounted EventForm; real browser and live API gates remain separate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { EventForm } from "../.test-dist/apps/ops/src/components/event/EventForm.js";
import { eventFormStyles, eventFormCss } from "../.test-dist/apps/ops/src/components/event/eventFormStyles.js";
import { portCssModule } from "../scripts/portCssModule.mjs";
import { buildFormDraftStorageKey } from "../.test-dist/apps/ops/src/lib/useFormDraft.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const noop = async () => ({ ok: false });
const base = { mode: "create", createEvent: noop, updateEvent: noop, router: { push() {}, refresh() {} } };
const field = (form, name) => form.querySelector('[name="' + name + '"]');

test("U01 preserves CURRENT JSX, submit flow and generated CSS selectors", () => {
  const current = read("../../../src/components/admin/EventForm.tsx");
  const target = read("../src/components/event/EventForm.tsx");
  const submitStart = "  const submit = (event: React.FormEvent<HTMLFormElement>) => {";
  const submitEnd = "  const submitLabel =";
  const block = s => s.slice(s.indexOf(submitStart), s.indexOf(submitEnd));
  assert.ok(block(current).length > 1000);
  assert.equal(block(target), block(current));
  const renderStart = "  const submitLabel =";
  assert.equal(target.slice(target.indexOf(renderStart)).replace("      <style>{eventFormCss}</style>\n", ""), current.slice(current.indexOf(renderStart)));
  assert.equal(eventFormCss, portCssModule(read("../../../src/components/admin/EventForm.module.css"), "ops-event-form"));
  for (const match of target.matchAll(/\bstyles\.([A-Za-z]\w*)/g)) {
    assert.equal(eventFormStyles[match[1]], "ops-event-form-" + match[1]);
    assert.ok(eventFormCss.includes("." + eventFormStyles[match[1]]));
  }
});

test("U01 create mode preserves all section anchors, template and Tokyo timestamp fields", () => {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(EventForm, {
    ...base, templateId: "event-template",
    initial: { title: "Test event", start_time: Date.UTC(2026, 4, 19, 3, 34) / 1000, end_time: null, visibility_status: "archived" }
  })));
  try {
    const form = dom.window.document.querySelector("form");
    assert.deepEqual([...form.querySelectorAll("nav a")].map(a => a.getAttribute("href")), ["#section-basic", "#section-publish", "#section-questions", "#section-required", "#section-slots"]);
    assert.equal(field(form, "template_id").value, "event-template");
    assert.equal(field(form, "start_time").value, "2026-05-19T12:34");
    assert.equal(field(form, "end_time").value, "");
    assert.equal(field(form, "visibility_status").value, "private");
    assert.equal(field(form, "required_video_fields_present").value, "1");
    assert.equal(field(form, "custom_questions_present").value, "1");
    assert.equal(field(form, "general_custom_questions_present").value, "1");
    assert.equal(form.querySelector('button[type="submit"]').textContent, "イベントを作成");
  } finally { dom.window.close(); }
});

test("T06 slots-only staff retains denied section values without enabling edits", () => {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(EventForm, {
    ...base, mode: "edit", variant: "manage",
    initial: { id: "event-a", updated_at: 123, title: "Locked title", event_type: "collabo", visibility_status: "public", slot_type: "count", max_slots_per_video: 3 },
    editableSections: { basic: false, publish: false, questions: false, slots: true }
  })));
  try {
    const form = dom.window.document.querySelector("form");
    const data = new dom.window.FormData(form);
    assert.equal(field(form, "title").readOnly, true);
    assert.equal(field(form, "event_type").type, "hidden");
    assert.equal(data.get("event_type"), "collabo");
    assert.equal(data.get("visibility_status"), "public");
    assert.equal(data.get("revision"), "123");
    assert.equal(data.get("id"), "event-a");
    assert.equal(field(form, "slot_type").disabled, false);
    assert.equal(field(form, "max_slots_per_video").readOnly, false);
    assert.equal(data.get("max_slots_per_video"), "3");
    assert.equal(form.querySelectorAll("fieldset > p[role=status]").length, 4);
    assert.equal(form.querySelector('button[type="submit"]').textContent, "変更を保存");
  } finally { dom.window.close(); }
});

async function withForm(props, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://flamenode.test/admin/events/new", pretendToBeVisual: true });
  const keys = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Node", "Event", "MouseEvent", "FormData", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : dom.window[key] });
  const node = dom.window.document.getElementById("root");
  const root = createRoot(node);
  try {
    await React.act(async () => root.render(React.createElement(EventForm, { ...base, ...props })));
    const form = node.querySelector("form");
    const submit = () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await run({ dom, form, submit });
  } finally {
    try { await React.act(async () => root.unmount()); }
    finally {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  }
}

test("T01/T04 create sends one FormData, clears the draft and navigates with encoded event ID", async () => {
  const calls = [], destinations = [];
  let refreshes = 0, resolve;
  const pending = new Promise(r => { resolve = r; });
  await withForm({
    draftAuthUserId: "test-user", templateId: "t1",
    initial: { title: "Create event" },
    createEvent(data) { calls.push(data); return pending; },
    router: { push(href) { destinations.push(href); }, refresh() { refreshes++; } }
  }, async ({ dom, submit }) => {
    const key = buildFormDraftStorageKey({ authUserId: "test-user", formId: "event-create-t1", schemaVersion: "event-form-v3" });
    dom.window.localStorage.setItem(key, "draft-to-clear");
    await React.act(async () => { submit(); submit(); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].get("title"), "Create event");
    assert.equal(calls[0].get("template_id"), "t1");
    await React.act(async () => { resolve({ ok: true, eventId: "new-event", pendingPublicReflection: true }); });
    assert.deepEqual(destinations, ["/manage/events/new-event/edit"]);
    assert.equal(refreshes, 0);
    assert.equal(dom.window.localStorage.getItem(key), null);
  });
});

test("T02 empty choice options refuse submission with CURRENT message", async () => {
  let calls = 0;
  const question = { clientId: "c1", question_key: "q1", label: "質問A", description: "", type: "select", required: false, options: [], placeholder: "", enabled: true };
  await withForm({ initial: { title: "Test", custom_questions: [question] }, createEvent: async () => { calls++; return { ok: true }; } }, async ({ form, submit }) => {
    await React.act(async () => submit());
    assert.equal(calls, 0);
    assert.equal(form.querySelector(".fn-error").textContent, "質問Aの選択肢を1件以上入力してください。");
  });
});

test("U01 edit failure preserves input and successful retry refreshes without redirect", async () => {
  const calls = [];
  let refreshes = 0, redirects = 0;
  await withForm({
    mode: "edit", variant: "manage", initial: { id: "event-a", updated_at: 9, title: "Keep title" },
    updateEvent: async data => { calls.push(data); return calls.length === 1 ? { ok: false, message: "保存失敗" } : { ok: true, pendingPublicReflection: true }; },
    router: { push() { redirects++; }, refresh() { refreshes++; } }
  }, async ({ form, submit }) => {
    await React.act(async () => submit());
    assert.equal(form.querySelector(".fn-error").textContent, "保存失敗");
    assert.equal(field(form, "title").value, "Keep title");
    assert.equal(refreshes, 0);
    await React.act(async () => submit());
    assert.equal(calls.length, 2);
    assert.equal(calls[1].get("revision"), "9");
    assert.equal(redirects, 0);
    assert.equal(refreshes, 1);
    assert.match(form.querySelector(".fn-success").textContent, /保存しました。/);
    assert.match(form.querySelector(".fn-success").textContent, /公開ページへの反映/);
  });
});

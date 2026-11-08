import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { SlotBatchForm, parseSlotGenerateForm } from "../.test-dist/apps/ops/src/routes/manage/SlotBatchForm.js";

const data = values => {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, String(value));
  return form;
};

test("MIG-0722 U02b-1: JST timed generation is bounded and calendar-validated", () => {
  const values = { start_at: "2026-11-08T10:00", end_at: "2026-11-08T10:30", interval_minutes: "5" };
  assert.deepEqual(parseSlotGenerateForm(data(values), "time"), {
    ok: true,
    value: { mode: "time", start_at: values.start_at, end_at: values.end_at, interval_minutes: 5 },
  });
  const validHundred = parseSlotGenerateForm(data({
    start_at: "2026-11-08T10:00", end_at: "2026-11-08T11:40", interval_minutes: "1",
  }), "time");
  assert.equal(validHundred.ok, true, "100 one-minute slots is allowed");
  for (const overrides of [
    { end_at: "2026-11-08T10:00" },
    { end_at: "2026-11-08T09:55" },
    { end_at: "2026-11-08T10:04" },
    { end_at: "2026-11-09T10:00", interval_minutes: "5" },
    { start_at: "2026-02-30T10:00" },
    { start_at: "2026-11-08T24:00" },
    { start_at: "2026-11-08T10:00Z" },
    { interval_minutes: "0" },
    { interval_minutes: "1441" },
    { interval_minutes: "1.5" },
    { interval_minutes: "Infinity" },
    { interval_minutes: "-1" },
  ]) {
    const result = parseSlotGenerateForm(data({ ...values, ...overrides }), "time");
    assert.equal(result.ok, false, JSON.stringify(overrides));
  }
});

test("MIG-0722 U02b-1: count generation preserves CURRENT bounds, rejects coercion", () => {
  const values = { count: "100", label_prefix: "  No.  ", start_index: "0" };
  assert.deepEqual(parseSlotGenerateForm(data(values), "count"), {
    ok: true,
    value: { mode: "count", count: 100, label_prefix: "No.", start_index: 0 },
  });
  for (const overrides of [
    { count: "0" }, { count: "101" }, { count: "true" }, { count: "1.1" },
    { count: " 1" }, { start_index: "10000" }, { start_index: "-1" },
    { start_index: "1.5" }, { label_prefix: "x".repeat(41) },
  ]) {
    assert.equal(parseSlotGenerateForm(data({ ...values, ...overrides }), "count").ok,
      false, JSON.stringify(overrides));
  }
  assert.equal(parseSlotGenerateForm(new FormData(), "count").ok, false);
});

test("MIG-0722 U02b-1: unmounted JSX preserves CURRENT labels without invoking writes", () => {
  let called = false;
  const props = {
    eventId: "ev/id", totalSlots: 12,
    onGenerate: async () => { called = true; return { ok: true }; },
    onClearAvailable: async () => { called = true; return { ok: true }; },
  };
  const html = renderToStaticMarkup(React.createElement(SlotBatchForm, props));
  assert.match(html, /枠を追加・一括編集/);
  assert.match(html, /<details/);
  assert.match(html, /開始日時/);
  assert.match(html, /終了日時/);
  assert.match(html, /枠の間隔・長さ/);
  assert.match(html, /一括生成/);
  assert.match(html, /空き枠を全削除/);
  assert.doesNotMatch(html, /role="alertdialog"|全削除する/);
  assert.equal(called, false);
  const empty = renderToStaticMarkup(React.createElement(SlotBatchForm, { ...props, totalSlots: 0 }));
  assert.match(empty, /枠がまだないため/);
  assert.doesNotMatch(empty, /<details/);
});


test("MIG-0722 U02b-1: synchronous lock prevents duplicate rapid form submissions", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.test/manage/events/ev1/slots",
  });
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "navigator", "FormData"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value: dom.window[key],
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    let completes;
    const calls = [];
    const onGenerate = body => {
      calls.push(body);
      return new Promise(resolve => { completes = resolve; });
    };
    await React.act(async () => root.render(React.createElement(SlotBatchForm, {
      eventId: "ev1", totalSlots: 0, onGenerate,
      onClearAvailable: async () => ({ ok: true }),
    })));
    const form = dom.window.document.querySelector("form");
    form.querySelector('[name="start_at"]').value = "2026-11-08T10:00";
    form.querySelector('[name="end_at"]').value = "2026-11-08T10:30";
    // Dispatch both submits in one event loop before any React re-render.
    await React.act(async () => {
      const submit = () => form.dispatchEvent(new dom.window.Event("submit", {
        bubbles: true, cancelable: true,
      }));
      submit();
      submit();
    });
    assert.equal(calls.length, 1, "no duplicate Hono callback can be sent");
    assert.deepEqual(calls[0], {
      mode: "time", start_at: "2026-11-08T10:00",
      end_at: "2026-11-08T10:30", interval_minutes: 5,
    });
    await React.act(async () => completes({ ok: true, message: "生成完了" }));
    assert.match(dom.window.document.body.textContent, /生成完了/);
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct;
    dom.window.close();
  }
});

test("MIG-0722 U02b-4: stale batch result after event change is ignored on success and error", async () => {
  for (const rejected of [false, true]) {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", {
      url: "https://flamenode.test/manage/events/old/slots",
    });
    const keys = ["window", "document", "Element", "HTMLElement", "Node", "navigator", "FormData"];
    const old = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
    for (const k of keys) Object.defineProperty(globalThis, k, {
      configurable: true, writable: true, value: dom.window[k],
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(dom.window.document.getElementById("root"));
    try {
      let settle;
      let writes = 0, refreshed = 0;
      const onGenerate = () => {
        writes++;
        return new Promise((resolve, reject) => { settle = rejected ? reject : resolve; });
      };
      let clears = 0;
      const onClearAvailable = async () => { clears++; return { ok: true }; };
      const onChanged = () => { refreshed++; };
      const view = eventId => React.createElement(SlotBatchForm, {
        eventId, totalSlots: 0, onGenerate, onClearAvailable, onChanged,
      });
      await React.act(async () => root.render(view("old-event")));
      const form = dom.window.document.querySelector("form");
      form.querySelector('[name="start_at"]').value = "2026-11-08T10:00";
      form.querySelector('[name="end_at"]').value = "2026-11-08T10:30";
      await React.act(async () => form.dispatchEvent(new dom.window.Event("submit", {
        bubbles: true, cancelable: true,
      })));
      assert.equal(writes, 1);
      await React.act(async () => root.render(view("new-event")));
      await React.act(async () => {
        if (rejected) settle(new Error("OLD-ERROR"));
        else settle({ ok: true, message: "OLD-SUCCESS" });
      });
      assert.equal(refreshed, 0, "old write cannot refresh the new event");
      assert.doesNotMatch(dom.window.document.body.textContent, /OLD-SUCCESS|通信エラー/);
      const clear = [...dom.window.document.querySelectorAll("button")]
        .find(button => button.textContent.trim() === "空き枠を全削除");
      await React.act(async () => clear.click());
      assert.ok(dom.window.document.querySelector('[aria-label="空き枠の全削除確認"]'));
      await React.act(async () => root.render(view("third-event")));
      assert.equal(dom.window.document.querySelector('[aria-label="空き枠の全削除確認"]'), null);
      assert.equal(clears, 0, "event transition must not execute an old clear confirmation");
    } finally {
      await React.act(async () => root.unmount());
      for (const [key, descriptor] of old) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct;
      dom.window.close();
    }
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
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

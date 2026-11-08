import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseMemberChaptersJson,
  serializeMemberChaptersJson,
} from "./memberChaptersJson.ts";

test("chapter JSON rejects negative, fractional, empty, boolean and unsafe times", () => {
  const raw = JSON.stringify([
    { time_seconds: -1, label: "negative" },
    { time_seconds: 1.5, label: "fractional" },
    { time_seconds: "", label: "empty" },
    { time_seconds: true, label: "boolean" },
    { time_seconds: "9007199254740992", label: "unsafe" },
    { time_seconds: 0, label: "zero", order_index: "Infinity" },
    { chapter_time: "90", chapter_label: "legacy", sort_order: "0", note: "ok" },
  ]);
  assert.deepEqual(parseMemberChaptersJson(raw), [
    { time_seconds: 90, label: "legacy", note: "ok", order_index: 0 },
    { time_seconds: 0, label: "zero", note: "", order_index: 5 },
  ]);
});

test("chapter JSON falls back to array order for malformed sort indexes", () => {
  const raw = JSON.stringify([
    { time_seconds: 1, label: "one", order_index: "Infinity" },
    { time_seconds: 2, label: "two", order_index: -1 },
    { time_seconds: 3, label: "three", order_index: 1.5 },
    { time_seconds: 4, label: "four", order_index: "9007199254740992" },
    { time_seconds: 5, label: "five", order_index: 0 },
  ]);
  assert.deepEqual(parseMemberChaptersJson(raw).map((x) => x.label), [
    "one", "five", "two", "three", "four",
  ]);
  assert.deepEqual(parseMemberChaptersJson(raw).map((x) => x.order_index), [0, 0, 1, 2, 3]);
});

test("chapter JSON preserves valid serialize/parse round trip", () => {
  const chapters = [
    { time_seconds: 0, label: "Intro", note: "", order_index: 0 },
    { time_seconds: 90, label: "Main", note: "speaker", order_index: 1 },
  ];
  assert.deepEqual(parseMemberChaptersJson(serializeMemberChaptersJson(chapters)), chapters);
  assert.deepEqual(parseMemberChaptersJson("not json"), []);
  assert.deepEqual(parseMemberChaptersJson("{}"), []);
});

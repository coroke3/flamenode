import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { normalizeUnslottedEventQuery } from "./unslottedEventQuery.ts";

test("entry/unslotted: repeated, malformed and missing event_q never throw", () => {
  for (const value of [undefined, null, ["first", "second"], ["one"], 4, {}, true]) {
    assert.equal(normalizeUnslottedEventQuery(value), "", String(value));
  }
  assert.equal(normalizeUnslottedEventQuery("  video event  "), "video event");
  assert.equal(normalizeUnslottedEventQuery("  "), "");
});

test("entry/unslotted: 100 UTF-16-unit limit never splits an emoji", () => {
  const split = "A".repeat(99) + "😀";
  const whole = "A".repeat(98) + "😀";
  assert.equal(normalizeUnslottedEventQuery(split), "A".repeat(99));
  assert.equal(normalizeUnslottedEventQuery(whole), whole);
  assert.equal(normalizeUnslottedEventQuery("😀".repeat(51)), "😀".repeat(50));
  assert.equal(normalizeUnslottedEventQuery("x".repeat(110)).length, 100);
  assert.ok(!/[\uD800-\uDBFF]$/.test(normalizeUnslottedEventQuery(split)));
});

test("entry/unslotted page uses the tested query normalizer", () => {
  const page = readFileSync(new URL("../../../app/(auth)/entry/unslotted/page.tsx", import.meta.url), "utf8");
  assert.match(page, /event_q\?: string \| string\[\]/);
  assert.match(page, /normalizeUnslottedEventQuery\(\(await searchParams\)\?\.event_q\)/);
  assert.doesNotMatch(page, /event_q\s*\?\?\s*""\)\.trim\(\)/);
});

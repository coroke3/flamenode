import assert from "node:assert/strict";
import test from "node:test";
import {
  RANDOM_VIDEO_POOL_SCHEMA_VERSION,
  normalizeRandomVideoPool,
} from "../src/publicData/randomVideoPoolCore.ts";

function payload(overrides = {}) {
  return {
    schema_version: RANDOM_VIDEO_POOL_SCHEMA_VERSION,
    generated_at: 1_729_000_000,
    generation_key: "generation-a",
    items: [],
    ...overrides,
  };
}

test("random video pool rejects non-object JSON payloads", () => {
  for (const value of [null, undefined, "payload", 1, true, [], ["payload"]]) {
    assert.equal(normalizeRandomVideoPool(value), null, String(value));
  }
});

test("random video pool requires literal numeric schema version 1", () => {
  for (const schemaVersion of ["1", true, false, [], [1], {}, " "]) {
    assert.equal(
      normalizeRandomVideoPool(payload({ schema_version: schemaVersion })),
      null,
      JSON.stringify(schemaVersion),
    );
  }
});

test("random video pool rejects coerced and malformed generated_at values", () => {
  for (const generatedAt of [
    true,
    false,
    [],
    [1_729_000_000],
    {},
    " ",
    "0x64",
    "Infinity",
    "1e309",
    Infinity,
    -Infinity,
    NaN,
    0,
    -1,
  ]) {
    assert.equal(
      normalizeRandomVideoPool(payload({ generated_at: generatedAt })),
      null,
      String(generatedAt),
    );
  }
});

test("random video pool preserves finite numbers and decimal numeric-string compatibility", () => {
  const numeric = normalizeRandomVideoPool(payload({ generated_at: 1_729_000_000 }));
  assert.ok(numeric);
  assert.equal(numeric.generatedAt, 1_729_000_000);

  const legacyString = normalizeRandomVideoPool(payload({ generated_at: "1729000000" }));
  assert.ok(legacyString);
  assert.equal(legacyString.generatedAt, 1_729_000_000);

  const fractional = normalizeRandomVideoPool(payload({ generated_at: "1729000000.9" }));
  assert.ok(fractional);
  assert.equal(fractional.generatedAt, 1_729_000_000);
});

test("random video pool preserves generation timestamps with a leading or trailing decimal point", () => {
  for (const [generatedAt, expected] of [
    ["1729000000.", 1_729_000_000],
    [".1729e10", 1_729_000_000],
    ["1.", 1],
    [".15e1", 1],
  ]) {
    assert.equal(
      normalizeRandomVideoPool(payload({ generated_at: generatedAt }))?.generatedAt,
      expected,
      generatedAt,
    );
  }
});

test("random video pool retains valid empty pools and their generation key", () => {
  const normalized = normalizeRandomVideoPool(payload());
  assert.ok(normalized);
  assert.equal(normalized.generationKey, "generation-a");
  assert.deepEqual(normalized.items, []);
});

test("random video pool drops malformed item scheduled_time values without poisoning valid pool metadata", () => {
  for (const scheduledTime of [true, false, [], [1_728_000_000], {}, " ", "0x64", "0b10", "Infinity", "1e309"]) {
    const normalized = normalizeRandomVideoPool(payload({
      items: [{
        id: "video-a",
        title: "Video A",
        display_name: "Creator",
        scheduled_time: scheduledTime,
      }],
    }));
    assert.ok(normalized, String(scheduledTime));
    assert.deepEqual(normalized.items, [], String(scheduledTime));
  }
});

test("random video pool preserves nullable and primitive numeric item timestamps", () => {
  for (const [scheduledTime, expected] of [
    [null, null],
    [undefined, null],
    ["", null],
    [0, 0],
    [1_728_000_000, 1_728_000_000],
    ["1728000000", 1_728_000_000],
    ["1729000000.", 1_729_000_000],
    [".5", 0],
    ["-.5", -1],
  ]) {
    const normalized = normalizeRandomVideoPool(payload({
      items: [{
        id: "video-a",
        title: "Video A",
        display_name: "Creator",
        scheduled_time: scheduledTime,
      }],
    }));
    assert.ok(normalized);
    assert.equal(normalized.items[0]?.scheduled_time, expected, String(scheduledTime));
  }
});

test("random video pool requires positive date-representable normalized generation seconds", () => {
  for (const generated_at of [0.5, "0.5", 1e308, "1e308", 8_640_000_000_001, "8640000000001"]) {
    assert.equal(normalizeRandomVideoPool(payload({ generated_at })), null, String(generated_at));
  }
  for (const [generated_at, expected] of [[1, 1], ["1.5", 1], [8_640_000_000_000, 8_640_000_000_000], ["8640000000000", 8_640_000_000_000]]) {
    assert.equal(normalizeRandomVideoPool(payload({ generated_at }))?.generatedAt, expected);
  }
});

test("random video pool omits out-of-range items but retains valid and nullable timestamps", () => {
  const values = [8_640_000_000_001, "8640000000001", -8_640_000_000_001, "-8640000000001", 1e308, "1e308", 8_640_000_000_000, "-8640000000000", null, ""];
  const normalized = normalizeRandomVideoPool(payload({
    items: values.map((scheduled_time, index) => ({
      id: "video-" + index, title: "Video", display_name: "Creator", scheduled_time,
    })),
  }));
  assert.ok(normalized);
  assert.deepEqual(normalized.items.map(({ id, scheduled_time }) => [id, scheduled_time]), [
    ["video-6", 8_640_000_000_000],
    ["video-7", -8_640_000_000_000],
    ["video-8", null],
    ["video-9", null],
  ]);
});

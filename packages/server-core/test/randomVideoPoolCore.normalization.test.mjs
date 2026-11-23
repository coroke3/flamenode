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
  for (const scheduledTime of [null, 0, 1_728_000_000, "1728000000"]) {
    const normalized = normalizeRandomVideoPool(payload({
      items: [{
        id: "video-a",
        title: "Video A",
        display_name: "Creator",
        scheduled_time: scheduledTime,
      }],
    }));
    assert.ok(normalized);
    assert.equal(normalized.items[0].scheduled_time, scheduledTime == null ? null : Number(scheduledTime));
  }
});

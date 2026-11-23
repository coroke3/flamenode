import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOMMEND_CORE_SCHEMA_VERSION,
  normalizeRecommendCore,
} from "../src/publicData/staticRecommendCore.ts";

function payload(overrides = {}) {
  return {
    schema_version: RECOMMEND_CORE_SCHEMA_VERSION,
    generated_at: 1_729_000_000,
    recommended: [],
    latest: [],
    underrated: [],
    ...overrides,
  };
}

test("recommend core rejects non-object top-level JSON values", () => {
  for (const value of [null, undefined, "payload", 1, true, [], ["payload"]]) {
    assert.equal(normalizeRecommendCore(value), null, String(value));
  }
});

test("recommend core requires a literal numeric schema version", () => {
  for (const schemaVersion of ["1", true, false, [], [1], {}, " "]) {
    assert.equal(
      normalizeRecommendCore(payload({ schema_version: schemaVersion })),
      null,
      JSON.stringify(schemaVersion),
    );
  }
});

test("recommend core rejects coerced and malformed generated_at values", () => {
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
      normalizeRecommendCore(payload({ generated_at: generatedAt })),
      null,
      String(generatedAt),
    );
  }
});

test("recommend core preserves finite numeric and decimal numeric-string timestamps", () => {
  const numeric = normalizeRecommendCore(payload({ generated_at: 1_729_000_000 }));
  assert.ok(numeric);
  assert.equal(numeric.generatedAt, 1_729_000_000);

  const legacyString = normalizeRecommendCore(payload({ generated_at: "1729000000" }));
  assert.ok(legacyString);
  assert.equal(legacyString.generatedAt, 1_729_000_000);

  const fractional = normalizeRecommendCore(payload({ generated_at: "1729000000.9" }));
  assert.ok(fractional);
  assert.equal(fractional.generatedAt, 1_729_000_000);
});

test("recommend core preserves valid empty pools", () => {
  const normalized = normalizeRecommendCore(payload());
  assert.ok(normalized);
  assert.equal(normalized.recommended.length, 0);
  assert.equal(normalized.latest.length, 0);
  assert.equal(normalized.underrated.length, 0);
});

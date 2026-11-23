import test from "node:test";
import assert from "node:assert/strict";
import { normalizeYoutubeRelatedBlocklist } from "../src/publicData/staticYoutubeRelatedBlocklistCore.ts";

const valid = { schema_version: 1, generated_at: 1700000000, blocked: { " video ": "private", other: "missing_or_private" } };

test("youtube related blocklist accepts producer values and numeric-string timestamps", () => {
  for (const generated_at of [1700000000, "1700000000"]) {
    const result = normalizeYoutubeRelatedBlocklist({ ...valid, generated_at });
    assert.equal(result?.generatedAt, 1700000000);
    assert.equal(result?.reasons.get("video"), "private");
    assert.equal(result?.reasons.get("other"), "missing_or_private");
    assert.equal(result?.blockedIds.size, 2);
  }
});

test("youtube related blocklist rejects coerced schemas and malformed envelopes", () => {
  for (const value of [null, [], true, { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }, { ...valid, blocked: [] }, { ...valid, blocked: null }]) {
    assert.equal(normalizeYoutubeRelatedBlocklist(value), null);
  }
});

test("youtube related blocklist rejects coerced and invalid timestamps", () => {
  for (const generated_at of [true, false, [], [10], {}, " ", "", null, undefined, 0, -1, Infinity, NaN, "Infinity", "1e309"]) {
    assert.equal(normalizeYoutubeRelatedBlocklist({ ...valid, generated_at }), null);
  }
});

test("youtube related blocklist retains allowed reasons and ignores invalid entries", () => {
  const result = normalizeYoutubeRelatedBlocklist({ ...valid, blocked: { " ": "private", good: "private", bad: "unexpected" } });
  assert.deepEqual([...result?.blockedIds ?? []], ["good"]);
});

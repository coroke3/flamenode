import assert from "node:assert/strict";
import test from "node:test";
import {
  YOUTUBE_RELATED_BLOCKLIST_SCHEMA_VERSION,
  buildYoutubeRelatedBlocklistPayload,
  normalizeYoutubeRelatedBlocklist,
} from "../src/publicData/staticYoutubeRelatedBlocklistCore.ts";

function payload(overrides = {}) {
  return {
    schema_version: YOUTUBE_RELATED_BLOCKLIST_SCHEMA_VERSION,
    generated_at: 1_729_000_000,
    blocked: {
      video_a: "private",
      video_b: "missing_or_private",
    },
    ...overrides,
  };
}

test("related blocklist rejects non-object top-level payloads", () => {
  for (const value of [null, undefined, "payload", 1, true, [], ["payload"]]) {
    assert.equal(normalizeYoutubeRelatedBlocklist(value), null, String(value));
  }
});

test("related blocklist requires literal numeric schema version 1", () => {
  for (const schemaVersion of ["1", true, false, [], [1], {}, " "]) {
    assert.equal(
      normalizeYoutubeRelatedBlocklist(payload({ schema_version: schemaVersion })),
      null,
      JSON.stringify(schemaVersion),
    );
  }
});

test("related blocklist rejects non-primitive or invalid generated_at values", () => {
  for (const generatedAt of [true, false, [], [1_729_000_000], {}, " ", "Infinity", "1e309", Infinity, NaN, 0, -1]) {
    assert.equal(
      normalizeYoutubeRelatedBlocklist(payload({ generated_at: generatedAt })),
      null,
      String(generatedAt),
    );
  }
});

test("related blocklist blocked index must be a non-array object", () => {
  for (const blocked of [null, true, 1, "video_a", [], ["private"], [ { video_a: "private" } ]]) {
    assert.equal(
      normalizeYoutubeRelatedBlocklist(payload({ blocked })),
      null,
      JSON.stringify(blocked),
    );
  }
});

test("related blocklist preserves valid producer output and numeric-string timestamp compatibility", () => {
  const built = buildYoutubeRelatedBlocklistPayload(
    new Map([
      ["video_a", "private"],
      ["video_b", "missing_or_private"],
    ]),
    1_729_000_000,
  );
  assert.deepEqual(normalizeYoutubeRelatedBlocklist(built)?.blockedIds, new Set(["video_a", "video_b"]));

  const legacyString = normalizeYoutubeRelatedBlocklist(
    payload({ generated_at: "1729000000" }),
  );
  assert.ok(legacyString);
  assert.equal(legacyString.generatedAt, 1_729_000_000);
  assert.equal(legacyString.reasons.get("video_a"), "private");
});

test("related blocklist accepts a valid empty blocked index", () => {
  const normalized = normalizeYoutubeRelatedBlocklist(payload({ blocked: {} }));
  assert.ok(normalized);
  assert.equal(normalized.generatedAt, 1_729_000_000);
  assert.deepEqual(normalized.blockedIds, new Set());
  assert.deepEqual(normalized.reasons, new Map());
});

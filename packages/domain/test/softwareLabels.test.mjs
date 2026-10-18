import test from "node:test";
import assert from "node:assert/strict";
import {
  SOFTWARE_LABEL_MAX_ITEMS,
  SOFTWARE_LABEL_MAX_LENGTH,
  normalizeSoftwareCatalogName,
  normalizeSoftwareKey,
  normalizeSoftwareLabels,
} from "@flamenode/domain/software/labels";

test("softwareLabels: normalizeSoftwareCatalogName trims, NFKC normalizes and lowercases", () => {
  assert.equal(normalizeSoftwareCatalogName("  Ｖｏｉｃｅｖｏｘ  "), "voicevox");
  assert.equal(normalizeSoftwareCatalogName("AviUtl  Plugin"), "aviutl plugin");
});

test("softwareLabels: normalizeSoftwareKey removes all whitespace", () => {
  assert.equal(normalizeSoftwareKey("AviUtl Plugin"), "aviutlplugin");
  assert.equal(normalizeSoftwareKey("  DaVinci   Resolve  "), "davinciresolve");
});

test("softwareLabels: normalizeSoftwareLabels parses delimiters and caps at limits", () => {
  assert.deepEqual(normalizeSoftwareLabels(null), []);
  assert.deepEqual(normalizeSoftwareLabels(""), []);
  assert.deepEqual(normalizeSoftwareLabels("A, B、 C"), ["A", "B", "C"]);

  // Deduplication by normalized key
  assert.deepEqual(normalizeSoftwareLabels(["Voicevox", "voicevox", "VOICEVOX"]), ["Voicevox"]);

  // Max length cap per label
  const longLabel = "a".repeat(100);
  const normalized = normalizeSoftwareLabels(longLabel);
  assert.equal(normalized[0].length, SOFTWARE_LABEL_MAX_LENGTH);

  // Max items cap
  const manyLabels = Array.from({ length: 30 }, (_, i) => `tool-${i}`);
  assert.equal(normalizeSoftwareLabels(manyLabels).length, SOFTWARE_LABEL_MAX_ITEMS);
});

test("softwareLabels: handles null, undefined and nullish elements safely", () => {
  assert.equal(normalizeSoftwareCatalogName(null), "");
  assert.equal(normalizeSoftwareCatalogName(undefined), "");
  assert.equal(normalizeSoftwareKey(null), "");
  assert.equal(normalizeSoftwareKey(undefined), "");

  // Array containing null and undefined items
  const mixed = ["Blender", null, undefined, "After Effects", ""];
  assert.deepEqual(normalizeSoftwareLabels(mixed), ["Blender", "After Effects"]);
});


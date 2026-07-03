import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEmptySoftwareLabelsJson,
  buildSoftwareLabelsJson,
  normalizeSoftwareLabels,
  parseSoftwareLabelsJson,
  SOFTWARE_LABEL_MAX_LENGTH,
} from "./softwareLabels.ts";

test("normalizeSoftwareLabels splits common separators and removes duplicates", () => {
  assert.deepEqual(
    normalizeSoftwareLabels("After Effects\nBlender、 after effects;AviUtl，Blender"),
    ["After Effects", "Blender", "AviUtl"],
  );
});

test("normalizeSoftwareLabels caps item count and item length", () => {
  const labels = normalizeSoftwareLabels(
    Array.from({ length: 25 }, (_, index) =>
      index === 0 ? "A".repeat(120) : `Tool ${index}`,
    ),
  );
  assert.equal(labels.length, 20);
  assert.equal(labels[0].length, SOFTWARE_LABEL_MAX_LENGTH);
});

test("buildSoftwareLabelsJson stores source and normalized items", () => {
  const json = buildSoftwareLabelsJson("After Effects, Blender", "manual");
  assert.deepEqual(JSON.parse(json), {
    source: "manual",
    raw: "After Effects, Blender",
    items: ["After Effects", "Blender"],
  });
});

test("parseSoftwareLabelsJson supports empty markers and legacy fallback", () => {
  assert.deepEqual(parseSoftwareLabelsJson(buildEmptySoftwareLabelsJson("manual")), []);
  assert.deepEqual(parseSoftwareLabelsJson('["AviUtl","aviutl","Blender"]'), [
    "AviUtl",
    "Blender",
  ]);
  assert.deepEqual(parseSoftwareLabelsJson("After Effects, Blender"), [
    "After Effects",
    "Blender",
  ]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLegacyImportClientPreviewKey } from "./clientPreviewKey.ts";

function baseInput(content) {
  return {
    files: [
      {
        name: "video.json",
        size: 10,
        content,
        encoding: "utf-8",
      },
    ],
    importMode: "archive",
    enqueueStaticRebuild: true,
    staticRebuildStrategy: "event",
    eventStrategy: "skip",
    videoStrategy: "skip",
    updateXUsers: false,
  };
}

test("legacy import client preview key changes when same-length file content changes", () => {
  const before = buildLegacyImportClientPreviewKey(baseInput("abc"));
  const after = buildLegacyImportClientPreviewKey(baseInput("abd"));

  assert.notEqual(before, after);
  assert.equal(
    JSON.parse(before).files[0].length,
    JSON.parse(after).files[0].length,
  );
});

test("legacy import client preview key changes when strategy changes", () => {
  const before = buildLegacyImportClientPreviewKey(baseInput("abc"));
  const after = buildLegacyImportClientPreviewKey({
    ...baseInput("abc"),
    videoStrategy: "update",
  });

  assert.notEqual(before, after);
});

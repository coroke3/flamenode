import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLegacyImportText } from "./parse.ts";

test("parseLegacyImportText: strict JSON still works", () => {
  const parsed = parseLegacyImportText("video.json", '[{"eventid":"A","tlink":"Foo"}]');
  assert.deepEqual(parsed, [{ eventid: "A", tlink: "Foo" }]);
});

test("parseLegacyImportText: JSON-ish legacy object tolerates raw multiline strings", () => {
  const parsed = parseLegacyImportText(
    "video.json",
    `[
  {
    "eventid": "A,B",
    "member": "One,Two",
    "memberid": "FOO,
Bar",
    "tlink": "Creator"
  }
]`,
  );
  assert.deepEqual(parsed, [
    {
      eventid: "A,B",
      member: "One,Two",
      memberid: "FOO,\nBar",
      tlink: "Creator",
    },
  ]);
});

test("parseLegacyImportText: CSV import still works", () => {
  const parsed = parseLegacyImportText("video.csv", "eventid,tlink\nA,Foo\n");
  assert.deepEqual(parsed, [{ eventid: "A", tlink: "Foo" }]);
});

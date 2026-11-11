import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLegacyImportText as sharedParser } from "@flamenode/server-core/legacyImport/parse";
import { parseLegacyImportText as currentParser } from "../../../src/lib/import/legacy/parse.ts";

test("RH-002 U02 parser: CURRENT compatibility bridge uses canonical server-core function", () => {
  assert.equal(currentParser, sharedParser);
});

test("RH-002 U02 parser: BOM and CSV quoted comma/doubled quote retain source behavior", () => {
  const input = '\uFEFFid,title\n1,"x,y"\n2,"say ""hello"""\n';
  assert.deepEqual(sharedParser("data.csv", input), {
    name: "data.csv",
    rows: [
      { id: "1", title: "x,y" },
      { id: "2", title: 'say "hello"' },
    ],
  });
});

test("RH-002 U02 parser: TSV auto-detection, blank rows and header-trimming", () => {
  const input = " id \t display name \n1\t あ \n\t\n2\t い \n";
  assert.deepEqual(sharedParser("data.tsv", input), {
    name: "data.tsv", rows: [
      { id: "1", "display name": "あ" },
      { id: "2", "display name": "い" },
    ],
  });
});

test("RH-002 U02 parser: JSON object/wrapper/array and fallback loose objects", () => {
  assert.deepEqual(sharedParser("a.json", '{"events":[{"id":"e"}]}').rows, [{ id: "e" }]);
  assert.deepEqual(sharedParser("b.json", '[{"id":"1"},null,4,{"id":"2"}]').rows,
    [{ id: "1" }, { id: "2" }]);
  assert.deepEqual(sharedParser("c.json", '{"id":"solo"}').rows, [{ id: "solo" }]);
  assert.deepEqual(sharedParser("d.json", '{"id":"1"},\n{"id":"2"}').rows,
    [{ id: "1" }, { id: "2" }]);
});

test("RH-002 U02 parser: malformed or empty inputs fail closed with CURRENT messages", () => {
  assert.throws(() => sharedParser("broken.csv", 'id,title\n1,"not closed'), /引用符/);
  assert.throws(() => sharedParser("empty.csv", "id,title\n"), /取り込める行を検出できません/);
  assert.throws(() => sharedParser("empty.json", "[]"), /取り込める行を検出できません/);
  assert.equal(sharedParser("", '[{"id":"x"}]').name, "legacy-data.json");
});

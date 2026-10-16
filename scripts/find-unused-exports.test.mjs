import test from "node:test";
import assert from "node:assert/strict";
import { countReferences, exportedNames } from "./find-unused-exports.mjs";

test("exportedNames finds function, const, let and class exports", () => {
  const source = "export function a() {}\nexport async function b() {}\nexport const c = 1;\nexport let d;\nexport class E {}\nconst hidden = 2;";
  assert.deepEqual(exportedNames(source), ["a", "b", "c", "d", "E"]);
});

test("countReferences separates non-test and test callers and ignores the defining file", () => {
  const files = new Map([
    ["src/lib/x.ts", "export function used() {}\nexport function testOnly() {}\nexport function unused() {}\nused();"],
    ["src/app.ts", "import { used } from './lib/x.ts';\nused();"],
    ["src/lib/x.test.mjs", "import { testOnly } from './x.ts';"],
  ]);
  assert.deepEqual(countReferences(["src/lib/x.ts"], files), [
    { file: "src/lib/x.ts", name: "used", nonTest: 1, test: 0, local: 1 },
    { file: "src/lib/x.ts", name: "testOnly", nonTest: 0, test: 1, local: 0 },
    { file: "src/lib/x.ts", name: "unused", nonTest: 0, test: 0, local: 0 },
  ]);
});

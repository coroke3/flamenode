import test from "node:test";
import assert from "node:assert/strict";
import { countReferences, exportedNames } from "./find-unused-exports.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("spec and __tests__ are test-only, while production and local callers remain distinct", () => {
  const files = new Map([
    ["src/domain/item.ts", [
      "export const specOnly = 1;",
      "export const helperOnly = 2;",
      "export const production = 3;",
      "export const localOnly = 4;",
      "localOnly;",
    ].join("\n")],
    ["src/domain/item.spec.tsx", "import { specOnly } from './item';"],
    ["src/domain/item.spec.mjs", "import { specOnly } from './item';"],
    ["src/domain/__tests__/helper.ts", "import { helperOnly } from '../item';"],
    ["src/domain/consumer.ts", "import { production } from './item';"],
  ]);
  assert.deepEqual(countReferences(["src/domain/item.ts"], files), [
    { file: "src/domain/item.ts", name: "specOnly", nonTest: 0, test: 2, local: 0 },
    { file: "src/domain/item.ts", name: "helperOnly", nonTest: 0, test: 1, local: 0 },
    { file: "src/domain/item.ts", name: "production", nonTest: 1, test: 0, local: 0 },
    { file: "src/domain/item.ts", name: "localOnly", nonTest: 0, test: 0, local: 1 },
  ]);
});

test("CLI classifies git-tracked spec files with mts, cts and jsx extensions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "flamenode-export-refs-"));
  const write = (relativePath, contents) => {
    const fullPath = path.join(root, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
  };
  const source = "src/domain/item.ts";
  const exports = ["onlyMts", "onlyCts", "onlyJsx", "onlyTsx", "usedInApp"];
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    write(source, exports.map((name) => `export const ${name} = 1;`).join("\n"));
    for (const ext of ["mts", "cts", "jsx", "tsx"]) {
      const name = "only" + ext[0].toUpperCase() + ext.slice(1);
      write(`src/domain/item.spec.${ext}`, `import { ${name} } from './item';`);
    }
    write("src/domain/consumer.ts", "import { usedInApp } from './item';");
    write("src/domain/__tests__/helper.mts", "import { onlyMts } from '../item';");
    execFileSync("git", ["add", "--", "src"], { cwd: root });
    const script = fileURLToPath(new URL("./find-unused-exports.mjs", import.meta.url));
    const output = execFileSync(process.execPath, [script, source], { cwd: root, encoding: "utf8" });
    const rows = output.trim().split("\n").map((line) => line.split("\t"));
    assert.deepEqual(rows, [
      ["TEST_ONLY", source, "onlyMts", "non-test=0", "test=2", "local=0"],
      ["TEST_ONLY", source, "onlyCts", "non-test=0", "test=1", "local=0"],
      ["TEST_ONLY", source, "onlyJsx", "non-test=0", "test=1", "local=0"],
      ["TEST_ONLY", source, "onlyTsx", "non-test=0", "test=1", "local=0"],
      ["used", source, "usedInApp", "non-test=1", "test=0", "local=0"],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

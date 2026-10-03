import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectStaticGeneratorFiles,
  computeStaticGeneratorHash,
  extractRelativeSpecifiers,
  STATIC_GENERATOR_ROOTS,
} from "./static-generator-hash.mjs";

function write(repoRoot, relative, content) {
  const filePath = path.join(repoRoot, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function withFixture(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-gen-hash-"));
  try {
    write(
      repoRoot,
      "workers/json-generator/queue.ts",
      [
        'import { a } from "./a.ts";',
        'import type { T } from "../shared/types.ts";',
        'import { z } from "zod";',
        'export * from "./reexport.ts";',
        "export async function load() {",
        '  return import("./lazy.mjs");',
        "}",
        "",
      ].join("\n"),
    );
    write(repoRoot, "workers/json-generator/a.ts", 'import { b } from "../../src/lib/b.ts";\nexport const a = b;\n');
    write(repoRoot, "src/lib/b.ts", "export const b = 1;\n");
    write(repoRoot, "workers/shared/types.ts", "export type T = string;\n");
    write(repoRoot, "workers/json-generator/reexport.ts", 'export { c } from "./dir";\n');
    write(repoRoot, "workers/json-generator/dir/index.ts", "export const c = 1;\n");
    write(repoRoot, "workers/json-generator/lazy.mjs", "export default 1;\n");
    write(repoRoot, "workers/json-generator/a.test.mjs", "// test only\n");
    write(repoRoot, "app/page.tsx", "export default function Page() { return null; }\n");
    write(repoRoot, "docs/note.md", "# note\n");
    return callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

const ROOTS = ["workers/json-generator/queue.ts"];

test("extractRelativeSpecifiers は相対 import/export/dynamic import だけを拾う", () => {
  const specifiers = extractRelativeSpecifiers(
    [
      'import { a,',
      "  b,",
      '} from "./multi.ts";',
      'import "./side.ts";',
      'export { x } from "../up.ts";',
      'const m = await import("./dyn.ts");',
      'import pkg from "pkg";',
      '// import { c } from "./commented.ts";',
      '/* import { d } from "./block.ts"; */',
    ].join("\n"),
  );
  assert.deepEqual(specifiers.sort(), ["./dyn.ts", "./multi.ts", "./side.ts", "../up.ts"].sort());
});

test("推移閉包は相対 import を辿り、bare package と test と無関係ファイルを含めない", () =>
  withFixture((repoRoot) => {
    assert.deepEqual(collectStaticGeneratorFiles(repoRoot, ROOTS), [
      "src/lib/b.ts",
      "workers/json-generator/a.ts",
      "workers/json-generator/dir/index.ts",
      "workers/json-generator/lazy.mjs",
      "workers/json-generator/queue.ts",
      "workers/json-generator/reexport.ts",
      "workers/shared/types.ts",
    ]);
  }));

test("import 先を変更すると hash が変わり、無関係ファイルの変更では変わらない", () =>
  withFixture((repoRoot) => {
    const base = computeStaticGeneratorHash(repoRoot, ROOTS);
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(computeStaticGeneratorHash(repoRoot, ROOTS), base);

    write(repoRoot, "app/page.tsx", "export default function Page() { return 1; }\n");
    write(repoRoot, "docs/note.md", "# changed\n");
    write(repoRoot, "workers/json-generator/a.test.mjs", "// changed\n");
    assert.equal(computeStaticGeneratorHash(repoRoot, ROOTS), base);

    write(repoRoot, "src/lib/b.ts", "export const b = 2;\n");
    const changed = computeStaticGeneratorHash(repoRoot, ROOTS);
    assert.notEqual(changed, base);

    write(repoRoot, "src/lib/b.ts", "export const b = 1;\n");
    assert.equal(computeStaticGeneratorHash(repoRoot, ROOTS), base);
  }));

test("CRLF と LF は同じ hash になる", () =>
  withFixture((repoRoot) => {
    const base = computeStaticGeneratorHash(repoRoot, ROOTS);
    for (const relative of collectStaticGeneratorFiles(repoRoot, ROOTS)) {
      const filePath = path.join(repoRoot, relative);
      fs.writeFileSync(filePath, fs.readFileSync(filePath, "utf8").replaceAll("\n", "\r\n"));
    }
    assert.equal(computeStaticGeneratorHash(repoRoot, ROOTS), base);
  }));

test("解決できない相対 import と存在しない root は fail-closed で例外にする", () =>
  withFixture((repoRoot) => {
    assert.throws(
      () => computeStaticGeneratorHash(repoRoot, ["workers/json-generator/missing.ts"]),
      /root is missing/,
    );
    write(repoRoot, "workers/json-generator/a.ts", 'import "./nowhere.ts";\n');
    assert.throws(() => computeStaticGeneratorHash(repoRoot, ROOTS), /cannot resolve/);
  }));

test("実 repo の root は UI / docs を含まず json-generator と src/lib・workers/shared だけに閉じる", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const files = collectStaticGeneratorFiles(repoRoot);
  for (const root of STATIC_GENERATOR_ROOTS) assert.ok(files.includes(root), root);
  for (const file of files) {
    assert.match(file, /^(?:workers\/(?:json-generator|shared)|src\/lib)\//, file);
    assert.doesNotMatch(file, /\.test\./);
  }
  assert.match(computeStaticGeneratorHash(repoRoot), /^[0-9a-f]{64}$/);
});

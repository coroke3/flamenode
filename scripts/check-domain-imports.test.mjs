import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateDomainImports } from "./check-domain-imports.mjs";

describe("check-domain-imports", () => {
  it("passes on active repository packages/domain and packages/db", () => {
    const result = validateDomainImports();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.filesCheckedCount > 0);
  });

  it("detects forbidden import 'next/navigation' (T01)", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-domain-test-"));
    try {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "bad.ts"),
        `import { useRouter } from "next/navigation";\nexport function test() {}`,
        "utf8"
      );

      const result = validateDomainImports({
        rootDir: tempDir,
        targetDirs: [srcDir],
      });

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].specifier, "next/navigation");
      assert.strictEqual(result.errors[0].rule, "next/*");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects forbidden imports for react, hono, astro, server-only, and legacy src", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-domain-test-all-"));
    try {
      const srcDir = path.join(tempDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "multi-bad.ts"),
        [
          `import React from "react";`,
          `import { Hono } from "hono";`,
          `import "server-only";`,
          `import { something } from "@/lib/db/client";`,
        ].join("\n"),
        "utf8"
      );

      const result = validateDomainImports({
        rootDir: tempDir,
        targetDirs: [srcDir],
      });

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.errors.length, 4);
      const rules = result.errors.map((e) => e.rule);
      assert.ok(rules.includes("react"));
      assert.ok(rules.includes("hono"));
      assert.ok(rules.includes("server-only"));
      assert.ok(rules.includes("legacy src/** or @/*"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateServerCoreBoundaries } from "./check-server-core-boundaries.mjs";

function withFixture(files, run) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "server-core-boundary-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(rootDir, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    return run(rootDir);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

const check = (rootDir) =>
  validateServerCoreBoundaries({
    rootDir,
    coreDirs: [path.join(rootDir, "packages", "server-core", "src")],
    upstreamDirs: [
      path.join(rootDir, "packages", "domain", "src"),
      path.join(rootDir, "packages", "db", "src"),
    ],
  });

describe("check-server-core-boundaries", () => {
  it("T01 passes on the repository's packages/server-core", () => {
    const result = validateServerCoreBoundaries();
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(result.filesCheckedCount > 0);
  });

  it("T02 detects next, react, hono, server-only and legacy src imports", () => {
    withFixture(
      {
        "packages/server-core/src/bad.ts": [
          `import { unstable_rethrow } from "next/navigation";`,
          `import React from "react";`,
          `import { Hono } from "hono";`,
          `import "server-only";`,
          `import { x } from "@/lib/x";`,
          `import { y } from "../../../src/lib/y.ts";`,
        ].join("\n"),
      },
      (rootDir) => {
        const result = check(rootDir);
        assert.equal(result.ok, false);
        assert.deepEqual(
          result.errors.map((error) => error.specifier),
          ["next/navigation", "react", "hono", "server-only", "@/lib/x", "../../../src/lib/y.ts"],
        );
      },
    );
  });

  it("T03 detects process.env, getCloudflareContext and @opennextjs imports", () => {
    withFixture(
      {
        "packages/server-core/src/ambient.ts": [
          `import { getCloudflareContext } from "@opennextjs/cloudflare";`,
          `export const flag = process.env.QUEUE_DISPATCH_ENABLED;`,
          `export const ctx = () => getCloudflareContext();`,
        ].join("\n"),
      },
      (rootDir) => {
        const rules = check(rootDir).errors.map((error) => error.rule);
        assert.ok(rules.includes("@opennextjs/*"));
        assert.ok(rules.includes("process.env"));
        assert.ok(rules.includes("getCloudflareContext"));
      },
    );
  });

  it("T04 detects packages/domain and packages/db importing server-core", () => {
    withFixture(
      {
        "packages/server-core/src/ok.ts": `export const ok = 1;`,
        "packages/domain/src/a.ts": `import type { KvPort } from "@flamenode/server-core";`,
        "packages/db/src/b.ts": `export * from "@flamenode/server-core/ports";`,
      },
      (rootDir) => {
        const result = check(rootDir);
        assert.equal(result.ok, false);
        assert.deepEqual(
          result.errors.map((error) => error.file),
          ["packages/domain/src/a.ts", "packages/db/src/b.ts"],
        );
      },
    );
  });

  it("T05 ignores process.env and getCloudflareContext in comments and strings", () => {
    withFixture(
      {
        "packages/server-core/src/doc.ts": [
          `// never read process.env or call getCloudflareContext() here`,
          `export const note = "process.env is injected; getCloudflareContext is not used";`,
          `export const ok = true;`,
        ].join("\n"),
      },
      (rootDir) => {
        assert.deepEqual(check(rootDir).errors, []);
      },
    );
  });

  it("allows drizzle-orm, @flamenode/db and @flamenode/domain imports", () => {
    withFixture(
      {
        "packages/server-core/src/ok.ts": [
          `import { sql } from "drizzle-orm";`,
          `import { auditLogs } from "@flamenode/db/schema";`,
          `import { isEventOwner } from "@flamenode/domain/event";`,
          `export const marker = [sql, auditLogs, isEventOwner];`,
        ].join("\n"),
      },
      (rootDir) => {
        assert.deepEqual(check(rootDir).errors, []);
      },
    );
  });
});

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
    apiRouteDirs: [path.join(rootDir, "apps", "api", "src", "routes")],
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


  it("T03a detects bracket and globalThis process.env access", () => {
    withFixture(
      {
        "packages/server-core/src/ambient-access.ts": [
          'const a = process["env"].ONE;',
          "const b = process['env']?.TWO;",
          'const c = process[`env`].THREE;',
          "const d = globalThis.process.env.FOUR;",
          'const e = globalThis["process"]["env"].FIVE;',
        ].join("\n"),
      },
      (rootDir) => {
        const errors = check(rootDir).errors.filter((error) => error.rule === "process.env");
        assert.deepEqual(errors.map((error) => error.line), [1, 2, 3, 4, 5]);
      },
    );
  });

  it("T03aa detects parenthesized, non-null, as/satisfies and static globalThis host access", () => {
    withFixture(
      {
        "packages/server-core/src/ambient-wrapped.ts": [
          "const a = (process).env.ONE;",
          'const b = (process)["env"].TWO;',
          "const c = process!.env.THREE;",
          "const d = (globalThis.process).env.FOUR;",
          "const e = (globalThis[\"process\"]).env.FIVE;",
          'const f = (globalThis)["process"].env.SIX;',
          "const g = (process as any).env.SEVEN;",
          "const h = (globalThis as any).process.env.EIGHT;",
          "const i = (process satisfies typeof process).env.NINE;",
          'const j = process[("env")].TEN;',
        ].join("\n"),
      },
      (rootDir) => {
        const errors = check(rootDir).errors.filter((error) => error.rule === "process.env");
        assert.deepEqual(errors.map((error) => error.line), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      },
    );
  });

  it("T03ab detects destructuring of process.env", () => {
    withFixture(
      {
        "packages/server-core/src/ambient-destructure.ts": [
          "const { env } = process;",
          "const { env: a } = globalThis.process;",
          'const { ["env"]: b } = process;',
          "const { env: c } = (process as any);",
          "let d; ({ env: d } = process);",
          "let e; ({ env: e } = globalThis.process);",
        ].join("\n"),
      },
      (rootDir) => {
        const errors = check(rootDir).errors.filter((error) => error.rule === "process.env");
        assert.deepEqual(errors.map((error) => error.line), [1, 2, 3, 4, 5, 6]);
      },
    );
  });

  it("T03ac detects nested, parameter-default and alternate-root env access", () => {
    withFixture(
      {
        "packages/server-core/src/ambient-more.ts": [
          'const { process: { env } } = globalThis;',
          'const { ["process"]: { env: a } } = globalThis;',
          "let b; ({ process: { env: b } } = globalThis);",
          "export function f({ env } = process) { return env; }",
          "export const g = ({ env: e } = globalThis.process) => e;",
          "const h = global.process.env.K;",
          "const i = self.process.env.K;",
          "const j = (0, process).env.K;",
          "const k = globalThis.globalThis.process.env.K;",
          "const { global: { process: { env: l } } } = globalThis;",
        ].join("\n"),
      },
      (rootDir) => {
        const errors = check(rootDir).errors.filter((error) => error.rule === "process.env");
        assert.deepEqual(errors.map((error) => error.line), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      },
    );
  });

  it("T03ad rejects importing the process module", () => {
    withFixture(
      {
        "packages/server-core/src/p1.ts": 'import { env } from "node:process";',
        "packages/server-core/src/p2.ts": 'import * as p from "process";',
        "packages/server-core/src/p3.ts": 'const e = require("process").env;',
        "packages/server-core/src/p4.ts": 'export const e = (await import("node:process")).env;',
      },
      (rootDir) => {
        const errors = check(rootDir).errors.filter((error) => error.rule === "process module");
        assert.deepEqual(errors.map((error) => error.file).sort(), [
          "packages/server-core/src/p1.ts",
          "packages/server-core/src/p2.ts",
          "packages/server-core/src/p3.ts",
          "packages/server-core/src/p4.ts",
        ]);
      },
    );
  });

  it("T03ae catches logical/conditional fallbacks and assignment-nested defaults", () => {
    withFixture(
      {
        "packages/server-core/src/ambient-fallback.ts": [
          "const a = (globalThis.process ?? {}).env;",
          "const b = (process || {}).env;",
          "const c = (globalThis.process && {}).env;",
          "const { env = {} } = process ?? {};",
          "const { env } = process || {};",
          "const { env } = (ok ? process : {});",
          'const d = (typeof process === "object" ? process : undefined)?.env;',
          "const { process: { env: e } = {} } = globalThis;",
          "let f; ({ process: { env: f } = {} } = globalThis);",
          "let g; ({ process: { env: g } = {} } = globalThis.globalThis);",
          "const h = (ok ? globalThis : {}).process.env;",
          "const i = (ok ? globalThis.process : other).env;",
          "const j = (other ?? globalThis.process).env;",
        ].join("\n"),
      },
      (rootDir) => {
        const errors = check(rootDir).errors.filter((error) => error.rule === "process.env");
        assert.deepEqual(errors.map((error) => error.line), Array.from({ length: 13 }, (_, i) => i + 1));
      },
    );
  });

  it("T03af does not confuse unrelated fallback objects with ambient process", () => {
    withFixture(
      {
        "packages/server-core/src/other-fallback.ts": [
          "const a = (other ?? {}).env;",
          "const b = (other || {}).env;",
          "const c = (ok ? other : {}).env;",
          "const { env } = other || {};",
          "const { env } = (ok ? other : {});",
          "const { process: { env } } = otherGlobal;",
        ].join("\n"),
      },
      (rootDir) => assert.deepEqual(check(rootDir).errors, []),
    );
  });

  it("T03b ignores unrelated computed properties, comments, and string literals", () => {
    withFixture(
      {
        "packages/server-core/src/safe-access.ts": [
          'const argv = process["argv"];',
          "const versions = globalThis.process.versions;",
          "const unrelated = other.process.env;",
          "const { argv } = process;",
          "const { env } = other;",
          "const { versions: v } = globalThis.process;",
          "const { process: { argv: a2 } } = globalThis;",
          "export function f2({ argv } = process) { return argv; }",
          "const { env: e2 } = globalThis;",
          "const m = self.other.process.env;",
          'const text = "process[env] and globalThis.process.env";',
          "// process['env'] is prohibited",
        ].join("\n"),
      },
      (rootDir) => assert.deepEqual(check(rootDir).errors, []),
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

  it("T06 detects drizzle-orm and @flamenode/db imports in apps/api routes, allows server-core and the middleware", () => {
    withFixture(
      {
        "packages/server-core/src/ok.ts": `export const ok = 1;`,
        "apps/api/src/routes/bad.ts": [
          `import { sql } from "drizzle-orm";`,
          `import { drizzle } from "drizzle-orm/d1";`,
          `import { auditLogs } from "@flamenode/db/schema";`,
          `import { dbOk } from "@flamenode/dbx";`,
        ].join("\n"),
        "apps/api/src/routes/ok.ts": `import { sql } from "@flamenode/server-core/sql";\nexport const ok = sql;`,
        "apps/api/src/middleware/db.ts": `import { drizzle } from "drizzle-orm/d1";\nexport const ok = drizzle;`,
      },
      (rootDir) => {
        const result = check(rootDir);
        assert.equal(result.ok, false);
        assert.deepEqual(
          result.errors.map((error) => `${error.file}:${error.specifier}`),
          [
            "apps/api/src/routes/bad.ts:drizzle-orm",
            "apps/api/src/routes/bad.ts:drizzle-orm/d1",
            "apps/api/src/routes/bad.ts:@flamenode/db/schema",
          ],
        );
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

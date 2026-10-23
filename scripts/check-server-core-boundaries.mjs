#!/usr/bin/env node
// MIG-0612 (D-10): packages/server-core is the adapter-layer core shared by Next and Hono.
// It may use an injected drizzle handle, but must not reach the host on its own:
//  - no next/*, react, hono, astro, server-only, @/, src/, app/ imports (same rules as check-domain-imports)
//  - no @opennextjs/* import, no `process.env`, no `getCloudflareContext` reference
//    (env, KV, Queue, waitUntil arrive through src/ports.ts)
//  - packages/domain and packages/db must never import @flamenode/server-core
// Imports are read with the TypeScript scanner; `process.env` / `getCloudflareContext` are found on the
// AST, so comments and string literals do not count.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  FORBIDDEN_RULES,
  collectSourceFiles,
  extractImportSpecifiers,
} from "./check-domain-imports.mjs";

const SERVER_CORE_IMPORT_RULES = [
  ...FORBIDDEN_RULES.map((rule) => ({
    name: rule.name,
    test: rule.test,
    message: "forbidden in packages/server-core (D-10); inject it through src/ports.ts",
  })),
  {
    name: "@opennextjs/*",
    test: (spec) => spec.startsWith("@opennextjs/"),
    message: "OpenNext imports are forbidden in packages/server-core; the host supplies bindings through ports",
  },
];

function findAmbientHostReferences(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const found = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.name.text === "env"
    ) {
      found.push({ line: lineOf(node), specifier: "process.env", rule: "process.env", message: "ambient env is forbidden in packages/server-core; take values through EnvValues" });
    }
    if (ts.isIdentifier(node) && node.text === "getCloudflareContext") {
      found.push({ line: lineOf(node), specifier: "getCloudflareContext", rule: "getCloudflareContext", message: "request context is forbidden in packages/server-core; take ports as arguments" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function validateServerCoreBoundaries(options = {}) {
  const rootDir = options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const coreDirs = options.coreDirs ?? [path.join(rootDir, "packages", "server-core", "src")];
  const upstreamDirs = options.upstreamDirs ?? [
    path.join(rootDir, "packages", "domain", "src"),
    path.join(rootDir, "packages", "db", "src"),
  ];
  const errors = [];
  let filesCheckedCount = 0;
  const rel = (file) => path.relative(rootDir, file).replace(/\\/g, "/");

  for (const dir of coreDirs) {
    for (const file of collectSourceFiles(dir)) {
      filesCheckedCount += 1;
      const content = fs.readFileSync(file, "utf8");
      for (const { specifier, line } of extractImportSpecifiers(content)) {
        for (const rule of SERVER_CORE_IMPORT_RULES) {
          if (rule.test(specifier, file, rootDir)) {
            errors.push({ file: rel(file), line, specifier, rule: rule.name, message: rule.message });
          }
        }
      }
      for (const hit of findAmbientHostReferences(content, file)) {
        errors.push({ file: rel(file), ...hit });
      }
    }
  }

  for (const dir of upstreamDirs) {
    for (const file of collectSourceFiles(dir)) {
      const content = fs.readFileSync(file, "utf8");
      for (const { specifier, line } of extractImportSpecifiers(content)) {
        if (specifier === "@flamenode/server-core" || specifier.startsWith("@flamenode/server-core/")) {
          errors.push({
            file: rel(file),
            line,
            specifier,
            rule: "server-core is downstream of domain and db",
            message: "packages/domain and packages/db must not import @flamenode/server-core",
          });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, filesCheckedCount };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateServerCoreBoundaries();
  if (!result.ok) {
    console.error(`[check:server-core-boundaries] FAILED: ${result.errors.length} violation(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err.file}:${err.line} "${err.specifier}" -> ${err.message}`);
    }
    process.exit(1);
  }
  if (result.filesCheckedCount === 0) {
    console.error("[check:server-core-boundaries] FAILED: no files checked (wrong root?)");
    process.exit(1);
  }
  console.log(`[check:server-core-boundaries] OK (${result.filesCheckedCount} files checked)`);
}

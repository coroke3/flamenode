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

const API_ROUTE_DB_SPECIFIER = /^(?:drizzle-orm|@flamenode\/db)(?:\/|$)/;

// Parentheses and TS type-only wrappers do not change which host object is read.
function unwrapStaticExpression(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

// Only literal member names are accepted: dynamic property names are outside this guard.
// Match both process.env and its static computed/globalThis equivalents.
function hasStaticMemberName(node, memberName) {
  node = unwrapStaticExpression(node);
  if (ts.isPropertyAccessExpression(node)) return node.name.text === memberName;
  if (!ts.isElementAccessExpression(node)) return false;
  const argument = node.argumentExpression && unwrapStaticExpression(node.argumentExpression);
  return Boolean(argument) &&
    (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) &&
    argument.text === memberName;
}

function isProcessReference(node) {
  node = unwrapStaticExpression(node);
  if (ts.isIdentifier(node)) return node.text === "process";
  if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return false;
  const host = unwrapStaticExpression(node.expression);
  return ts.isIdentifier(host) &&
    host.text === "globalThis" &&
    hasStaticMemberName(node, "process");
}

// Static key of a destructuring property (`env`, `"env"`, `["env"]`); undefined when dynamic.
function staticPropertyKey(name) {
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    const inner = unwrapStaticExpression(name.expression);
    return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) ? inner.text : undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

// `const { env } = process`, `const { env: c } = globalThis.process`, `({ env } = process)`.
function isEnvDestructuring(node) {
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const key = staticPropertyKey(node.propertyName ?? node.name);
    const decl = node.parent.parent;
    return key === "env" && ts.isVariableDeclaration(decl) && Boolean(decl.initializer) && isProcessReference(decl.initializer);
  }
  if (
    (ts.isShorthandPropertyAssignment(node) || ts.isPropertyAssignment(node)) &&
    ts.isObjectLiteralExpression(node.parent)
  ) {
    const key = staticPropertyKey(node.name);
    const assign = node.parent.parent;
    return key === "env" && ts.isBinaryExpression(assign) &&
      assign.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      assign.left === node.parent && isProcessReference(assign.right);
  }
  return false;
}

function findAmbientHostReferences(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const found = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const visit = (node) => {
    if (
      isEnvDestructuring(node) ||
      ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        hasStaticMemberName(node, "env") &&
        isProcessReference(node.expression))
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

  // MIG-0617 (L2): Hono routes reach D1 only through server-core (the db handle comes from
  // dbMiddleware, the `sql` tag from @flamenode/server-core/sql).
  const apiRouteDirs = options.apiRouteDirs ?? [path.join(rootDir, "apps", "api", "src", "routes")];
  for (const dir of apiRouteDirs) {
    for (const file of collectSourceFiles(dir)) {
      const content = fs.readFileSync(file, "utf8");
      for (const { specifier, line } of extractImportSpecifiers(content)) {
        if (API_ROUTE_DB_SPECIFIER.test(specifier)) {
          errors.push({
            file: rel(file),
            line,
            specifier,
            rule: "apps/api routes reach D1 through server-core",
            message: "apps/api/src/routes must not import drizzle-orm or @flamenode/db; use @flamenode/server-core (and c.get(\"db\"))",
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

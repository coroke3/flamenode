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
  {
    name: "process module",
    test: (spec) => spec === "process" || spec === "node:process",
    message: "the process module exposes ambient env in packages/server-core; take values through EnvValues",
  },
];

const API_ROUTE_DB_SPECIFIER = /^(?:drizzle-orm|@flamenode\/db)(?:\/|$)/;

const GLOBAL_ROOTS = new Set(["globalThis", "global", "self"]);

// Parentheses, TS type-only wrappers and comma expressions (`(0, process)`) do not change which host object is read.
function unwrapStaticExpression(node) {
  for (;;) {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      node = node.expression;
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      node = node.right;
    } else {
      return node;
    }
  }
}

// Only literal member names are accepted: dynamic property names are outside this guard.
function staticMemberName(node) {
  node = unwrapStaticExpression(node);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (!ts.isElementAccessExpression(node)) return undefined;
  const argument = node.argumentExpression && unwrapStaticExpression(node.argumentExpression);
  return argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text
    : undefined;
}

function hasStaticMemberName(node, memberName) {
  return staticMemberName(node) === memberName;
}

// Nullish/logical and conditional expressions can return either branch.
// Match static host references on either branch so the common Workers-safe
// `(globalThis.process ?? {}).env` spelling cannot bypass this CI guard.
function staticHostAlternative(node, check) {
  if (ts.isBinaryExpression(node) && [
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
  ].includes(node.operatorToken.kind)) {
    return check(node.left) || check(node.right);
  }
  if (ts.isConditionalExpression(node)) {
    return check(node.whenTrue) || check(node.whenFalse);
  }
  return false;
}

// globalThis / global / self, including `globalThis.globalThis`.
function isGlobalReference(node) {
  node = unwrapStaticExpression(node);
  if (staticHostAlternative(node, isGlobalReference)) return true;
  if (ts.isIdentifier(node)) return GLOBAL_ROOTS.has(node.text);
  const name = staticMemberName(node);
  return name !== undefined && GLOBAL_ROOTS.has(name) && isGlobalReference(node.expression);
}

function isProcessReference(node) {
  node = unwrapStaticExpression(node);
  if (staticHostAlternative(node, isProcessReference)) return true;
  if (ts.isIdentifier(node)) return node.text === "process";
  return hasStaticMemberName(node, "process") && isGlobalReference(node.expression);
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

// Entries of an object binding pattern or object literal assignment target: [key, nested pattern].
function patternEntries(pattern) {
  const entries = [];
  if (ts.isObjectBindingPattern(pattern)) {
    for (const el of pattern.elements) {
      if (el.dotDotDotToken) continue;
      entries.push([staticPropertyKey(el.propertyName ?? el.name), ts.isObjectBindingPattern(el.name) ? el.name : undefined]);
    }
  } else {
    for (const prop of pattern.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) entries.push([prop.name.text, undefined]);
      else if (ts.isPropertyAssignment(prop)) {
        let init = unwrapStaticExpression(prop.initializer);
        // Object assignment destructuring supports nested defaults:
        // ({ process: { env: value } = {} } = globalThis).
        if (ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          init = unwrapStaticExpression(init.left);
        }
        entries.push([staticPropertyKey(prop.name), ts.isObjectLiteralExpression(init) ? init : undefined]);
      }
    }
  }
  return entries;
}

// Does destructuring `pattern` out of a "process" or "global" object bind process.env?
function patternReadsEnv(pattern, source) {
  for (const [key, nested] of patternEntries(pattern)) {
    if (key === undefined) continue;
    if (source === "process") {
      if (key === "env") return true;
    } else if (nested && key === "process") {
      if (patternReadsEnv(nested, "process")) return true;
    } else if (nested && GLOBAL_ROOTS.has(key)) {
      if (patternReadsEnv(nested, "global")) return true;
    }
  }
  return false;
}

function sourceKind(expression) {
  if (isProcessReference(expression)) return "process";
  return isGlobalReference(expression) ? "global" : undefined;
}

// `const { env } = process`, `const { process: { env } } = globalThis`, `({ env } = process)`,
// `function f({ env } = process)`.
function isEnvDestructuring(node) {
  let pattern;
  let initializer;
  if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isObjectBindingPattern(node.name)) {
    pattern = node.name;
    initializer = node.initializer;
  } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = unwrapStaticExpression(node.left);
    if (ts.isObjectLiteralExpression(left)) {
      pattern = left;
      initializer = node.right;
    }
  }
  if (!pattern || !initializer) return false;
  const source = sourceKind(initializer);
  return source !== undefined && patternReadsEnv(pattern, source);
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

#!/usr/bin/env node
// MIG-0307 U01: packages/domain and packages/db must stay framework-free and
// must not depend on the legacy Next tree. Specifiers are extracted with the
// TypeScript scanner (ts.preProcessFile), so multi-line imports, `import type`,
// `export ... from`, side-effect imports, dynamic import() and require() are
// all covered, while comments and string literals are ignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FORBIDDEN_RULES = [
  {
    name: "next/*",
    test: (spec) => spec === "next" || spec.startsWith("next/"),
    message: "Next.js imports are forbidden in domain and db packages",
  },
  {
    name: "react",
    test: (spec) =>
      spec === "react" ||
      spec === "react-dom" ||
      spec.startsWith("react/") ||
      spec.startsWith("react-dom/"),
    message: "React imports are forbidden in domain and db packages",
  },
  {
    name: "hono",
    test: (spec) => spec === "hono" || spec.startsWith("hono/"),
    message: "Hono imports are forbidden in domain and db packages",
  },
  {
    name: "astro",
    test: (spec) => spec === "astro" || spec.startsWith("astro/"),
    message: "Astro imports are forbidden in domain and db packages",
  },
  {
    name: "server-only",
    test: (spec) => spec === "server-only",
    message: "'server-only' import is forbidden in domain and db packages",
  },
  {
    name: "legacy src/** or @/*",
    test: (spec, filePath, rootDir) => {
      // tsconfig.json path aliases that point into the legacy Next tree.
      if (spec.startsWith("@/") || spec.startsWith("@app/") || spec.startsWith("#utils/")) {
        return true;
      }
      if (spec.startsWith(".") || path.isAbsolute(spec)) {
        const resolved = path.resolve(path.dirname(filePath), spec);
        for (const legacyDir of ["src", "app"]) {
          const relative = path.relative(path.resolve(rootDir, legacyDir), resolved);
          if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
            return true;
          }
        }
      }
      return false;
    },
    message: "Imports pointing to the legacy Next tree (src/**, app/**, @/*) are forbidden in domain and db packages",
  },
];

function collectSourceFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, result);
    } else if (entry.isFile() && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

function extractImportSpecifiers(content) {
  const { importedFiles } = ts.preProcessFile(content, true, true);
  return importedFiles.map((file) => ({
    specifier: file.fileName,
    line: content.slice(0, file.pos).split("\n").length,
  }));
}

export function validateDomainImports(options = {}) {
  const rootDir = options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Shipped package code only. Package tests may import a legacy bridge to
  // assert re-export identity (e.g. packages/domain/test/datetime.test.mjs).
  const targetDirs = options.targetDirs ?? [
    path.join(rootDir, "packages", "domain", "src"),
    path.join(rootDir, "packages", "db", "src"),
  ];

  const errors = [];
  let filesCheckedCount = 0;

  for (const targetDir of targetDirs) {
    for (const file of collectSourceFiles(targetDir)) {
      filesCheckedCount += 1;
      const content = fs.readFileSync(file, "utf8");
      for (const { specifier, line } of extractImportSpecifiers(content)) {
        for (const rule of FORBIDDEN_RULES) {
          if (rule.test(specifier, file, rootDir)) {
            errors.push({
              file: path.relative(rootDir, file).replace(/\\/g, "/"),
              line,
              specifier,
              rule: rule.name,
              message: rule.message,
            });
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, filesCheckedCount };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateDomainImports();
  if (!result.ok) {
    console.error(`[check:domain-imports] FAILED: ${result.errors.length} forbidden import(s) found:`);
    for (const err of result.errors) {
      console.error(`  - ${err.file}:${err.line} imports "${err.specifier}" -> ${err.message}`);
    }
    process.exit(1);
  }
  if (result.filesCheckedCount === 0) {
    console.error("[check:domain-imports] FAILED: no files checked (wrong root?)");
    process.exit(1);
  }
  console.log(`[check:domain-imports] OK (${result.filesCheckedCount} files checked)`);
}

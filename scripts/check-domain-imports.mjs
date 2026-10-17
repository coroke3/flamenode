#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      if (spec.startsWith("@/")) return true;
      if (/(?:^|[\\/])src[\\/]/.test(spec) && (spec.startsWith(".") || spec.startsWith("/"))) {
        return true;
      }
      if (spec.startsWith(".")) {
        const resolved = path.resolve(path.dirname(filePath), spec);
        const legacySrcDir = path.resolve(rootDir, "src");
        if (resolved.startsWith(legacySrcDir)) {
          return true;
        }
      }
      return false;
    },
    message: "Imports pointing to legacy Next 'src/**' are forbidden in domain and db packages",
  },
];

const IMPORT_EXPORT_REGEX =
  /(?:import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?|export\s+(?:(?:[\w*\s{},]*)\s+from\s+)|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

function collectSourceFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, result);
    } else if (entry.isFile() && /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

export function validateDomainImports(options = {}) {
  const rootDir = options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const targetDirs = options.targetDirs ?? [
    path.join(rootDir, "packages", "domain", "src"),
    path.join(rootDir, "packages", "db", "src"),
  ];

  const errors = [];
  const filesChecked = [];

  for (const targetDir of targetDirs) {
    const files = collectSourceFiles(targetDir);
    for (const file of files) {
      filesChecked.push(file);
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        // Skip comment lines
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
          continue;
        }

        let match;
        IMPORT_EXPORT_REGEX.lastIndex = 0;
        while ((match = IMPORT_EXPORT_REGEX.exec(line)) !== null) {
          const specifier = match[1];
          for (const rule of FORBIDDEN_RULES) {
            if (rule.test(specifier, file, rootDir)) {
              errors.push({
                file: path.relative(rootDir, file).replace(/\\/g, "/"),
                line: lineIndex + 1,
                specifier,
                rule: rule.name,
                message: rule.message,
              });
            }
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    filesCheckedCount: filesChecked.length,
  };
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
  console.log(`[check:domain-imports] OK (${result.filesCheckedCount} files checked)`);
}

#!/usr/bin/env node
/**
 * MIG-0649: conservative fail-closed inventory for literal R2 artifact keys.
 * Static source audit only: no R2 reads and no consumer changes.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_ROOTS = ["app", "src", "apps", "workers", "packages"];
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".next", ".astro", ".git", "fixtures", "__fixtures__", "__tests__", "test", "tests", "generated"]);
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mjs)$/;
const TEST_FILES = /(?:^|\/)[^/]+(?:\.test|\.spec)\.(?:ts|tsx|mjs)$/;

export function normalizeArtifactKey(key) {
  return key.trim().replace(/\x24\{[^{}]+\}/g, "<id>");
}

function isArtifactName(key) {
  return key.length > 0 && key.length <= 512 &&
    !key.startsWith("http:") && !key.startsWith("https:") &&
    (key.includes("/") || /\.(?:json|html|webp|png|jpg)$/i.test(key));
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * Scan literal producers and readers for named R2 bindings. Resolve simple
 * same-file const keys. Imported/computed keys are NOT assumed safe: record
 * every occurrence in the reviewed dynamic-reference ledger.
 *
 * This is deliberately a conservative source scanner, not a TypeScript
 * compiler. It does not infer storage semantics from arbitrary Map/KV calls.
 */
export function extractArtifactKeys(source, path) {
  const hits = [];
  const unresolved = [];
  const literal = "([\\\"'\\x60])((?:\\\\.|(?!\\1)[^\\n])*?)\\1";
  const addHit = (index, key, kind) => {
    if (isArtifactName(key)) {
      hits.push({ path, line: lineOf(source, index), key: normalizeArtifactKey(key), kind });
    }
  };
  // A local key declaration is resolved only when an R2 call uses it.
  const constants = new Map();
  const declarations = new RegExp("\\b(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*" + literal, "g");
  for (const match of source.matchAll(declarations)) constants.set(match[1], match[3]);

  const property = new RegExp("\\br2Key\\s*:\\s*" + literal, "g");
  for (const match of source.matchAll(property)) addHit(match.index, match[2], "r2Key");

  // Existing *_KEY producers are tracked even when the use site imports them.
  const named = new RegExp(
    "\\b(?:export\\s+)?const\\s+(?:[A-Z][A-Z0-9_]*(?:_OBJECT|_R2|_ARTIFACT|_RECENT_LIST|_TRENDING_OUTPUT)_KEY)\\s*=\\s*" + literal, "g",
  );
  for (const match of source.matchAll(named)) addHit(match.index, match[2], "object-constant");

  const calls = /\b(?:env\.)?(?:BUCKET|R2_STORAGE|R2|bucket|r2|safeBucket)\s*\.\s*(get|put|head|delete)\s*\(\s*/g;
  for (const match of source.matchAll(calls)) {
    const after = source.slice(match.index + match[0].length);
    const quoted = new RegExp("^" + literal).exec(after);
    if (quoted) {
      addHit(match.index, quoted[2], "bucket." + match[1]);
      continue;
    }
    const expression = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\([^()\n]*\))?)/.exec(after)?.[1];
    if (!expression) {
      unresolved.push({ path, line: lineOf(source, match.index), kind: "bucket." + match[1], expression: "<complex>" });
      continue;
    }
    if (constants.has(expression)) {
      addHit(match.index, constants.get(expression), "bucket." + match[1] + "-const");
    } else {
      // The source may import the symbol or compute it dynamically. It needs
      // an explicit bounded exception until a future MIG resolves the reader.
      unresolved.push({ path, line: lineOf(source, match.index), kind: "bucket." + match[1], expression });
    }
  }
  Object.defineProperty(hits, "unresolved", { value: unresolved, enumerable: false });
  return hits;
}

export function readDynamicExceptions(markdown) {
  const exceptions = new Map();
  const section = markdown.split("## Reviewed dynamic R2 calls")[1]?.split("\n## ")[0] ?? "";
  for (const line of section.split("\n")) {
    const match = /^\|\s*\x60([^\x60]+)\x60\s*\|\s*\x60([^\x60]+)\x60\s*\|\s*(\d+)\s*\|/.exec(line);
    if (match) exceptions.set(match[1] + "|" + match[2], Number(match[3]));
  }
  return exceptions;
}

export function matchesInventory(key, documented) {
  if (documented.has(key)) return true;
  for (const pattern of documented) {
    if (!pattern.includes("<id>")) continue;
    const escaped = pattern.split("<id>")
      .map((part) => part.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&"))
      .join("[^/]+");
    if (new RegExp("^" + escaped + "$").test(key)) return true;
  }
  return false;
}

export function readInventoryKeys(markdown) {
  const keys = new Set();
  for (const line of markdown.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function visit(root, sub = "") {
  const files = [];
  for (const entry of readdirSync(join(root, sub), { withFileTypes: true })) {
    const path = join(sub, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) files.push(...visit(root, path));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name) &&
      !TEST_FILES.test(path.replaceAll("\\", "/"))) {
      files.push(path);
    }
  }
  return files;
}

export function checkInventory({ root, inventoryText, files = null }) {
  const known = readInventoryKeys(inventoryText);
  const exceptions = readDynamicExceptions(inventoryText);
  const pathList = files ?? SOURCE_ROOTS.flatMap((dir) => visit(root, dir));
  const hits = [];
  const unresolved = [];
  for (const file of pathList) {
    const found = extractArtifactKeys(readFileSync(join(root, file), "utf8"), file.replaceAll("\\", "/"));
    hits.push(...found);
    unresolved.push(...found.unresolved);
  }
  const missing = hits.filter(({ key }) => !matchesInventory(key, known));
  const counts = new Map();
  for (const row of unresolved) {
    const key = row.path + "|" + row.kind + "(" + row.expression + ")";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const unexpected = [...counts].filter(([key, count]) => !exceptions.has(key) || count > exceptions.get(key))
    .map(([key, count]) => ({ key, count, limit: exceptions.get(key) ?? 0 }));
  return { known, hits, missing, unresolved, unexpected };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const root = resolve(dirname(self), "..");
  const inventoryText = readFileSync(join(root, "docs/migration/R2_ARTIFACT_CONSUMERS.md"), "utf8");
  const result = checkInventory({ root, inventoryText });
  if (result.missing.length || result.unexpected.length) {
    console.error("MIG-0649: undocumented literal R2 artifact keys:");
    for (const { path, line, key, kind } of result.missing) {
      console.error(path + ":" + line + " " + kind + " " + key);
    }
    for (const { key, count, limit } of result.unexpected) {
      console.error("unreviewed R2 call: " + key + " count=" + count + " documented_max=" + limit);
    }
    process.exitCode = 1;
  } else {
    console.log("MIG-0649 R2 inventory OK: " + result.hits.length + " references; " + result.known.size + " key patterns; " + result.unresolved.length + " reviewed dynamic call instances");
  }
}

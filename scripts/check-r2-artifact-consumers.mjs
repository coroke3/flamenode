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
 * Discover literal R2 key forms while excluding KV, Map.get, and URLs.
 * Dynamic computed expressions are inventoried manually in the accompanying
 * document: this intentionally does not guess their runtime values.
 */
export function extractArtifactKeys(source, path) {
  const hits = [];
  const literal = "([\\\"'\\x60])((?:\\\\.|(?!\\1)[^\\n])*?)\\1";
  const rules = [
    ["r2Key", new RegExp("\\br2Key\\s*:\\s*" + literal, "g")],
    ["bucket.get", new RegExp("\\b(?:env\\.)?(?:BUCKET|R2_STORAGE|R2|bucket|r2|safeBucket)\\s*\\.\\s*get\\s*\\(\\s*" + literal, "g")],
    ["object-constant", new RegExp("\\b(?:export\\s+)?const\\s+(?:[A-Z][A-Z0-9_]*(?:_OBJECT|_R2|_ARTIFACT|_RECENT_LIST|_TRENDING_OUTPUT)_KEY)\\s*=\\s*" + literal, "g")],
  ];
  for (const [kind, regex] of rules) {
    for (const match of source.matchAll(regex)) {
      if (!isArtifactName(match[2])) continue;
      hits.push({ path, line: lineOf(source, match.index), key: normalizeArtifactKey(match[2]), kind });
    }
  }
  return hits;
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
  const pathList = files ?? SOURCE_ROOTS.flatMap((dir) => visit(root, dir));
  const hits = pathList.flatMap((file) =>
    extractArtifactKeys(readFileSync(join(root, file), "utf8"), file.replaceAll("\\", "/")));
  const missing = hits.filter(({ key }) => !matchesInventory(key, known));
  return { known, hits, missing };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const root = resolve(dirname(self), "..");
  const inventoryText = readFileSync(join(root, "docs/migration/R2_ARTIFACT_CONSUMERS.md"), "utf8");
  const result = checkInventory({ root, inventoryText });
  if (result.missing.length) {
    console.error("MIG-0649: undocumented literal R2 artifact keys:");
    for (const { path, line, key, kind } of result.missing) {
      console.error(path + ":" + line + " " + kind + " " + key);
    }
    process.exitCode = 1;
  } else {
    console.log("MIG-0649 R2 inventory OK: " + result.hits.length + " references; " + result.known.size + " key patterns");
  }
}

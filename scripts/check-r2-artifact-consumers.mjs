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

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

// Known R2 bindings. A file may add aliases (see bindingAliases).
const R2_BINDINGS = ["BUCKET", "R2_STORAGE", "R2", "bucket", "r2", "safeBucket"];
// Helpers whose second argument is the R2 object key (bucket/env first).
// A new helper must call R2 directly, so its own body appears as a dynamic
// call below and fails CI until reviewed; add its name here at that time.
const R2_KEY_HELPERS = ["putJson", "putJsonUntracked", "putJsonArtifact", "readJsonObject", "readBoundedR2Json"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&");
}

/** Same-file names bound to an R2 bucket: `const x = env.BUCKET` or `x: R2Bucket`. */
function bindingAliases(source) {
  const names = new Set(R2_BINDINGS);
  const assigned = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:[\w$]+\.)*env\.(?:BUCKET|R2_STORAGE|R2)\b(?!\s*\.)/g;
  for (const match of source.matchAll(assigned)) names.add(match[1]);
  const typed = /\b([A-Za-z_$][\w$]*)\??\s*:\s*(?:R2Bucket\b|Pick<\s*R2Bucket\b)/g;
  for (const match of source.matchAll(typed)) names.add(match[1]);
  const destructured = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:[\w$]+\.)*env\b/g;
  for (const match of source.matchAll(destructured)) {
    for (const part of match[1].matchAll(/\b(?:BUCKET|R2_STORAGE|R2)\s*:\s*([A-Za-z_$][\w$]*)/g)) names.add(part[1]);
  }
  return names;
}

/** Helper names plus same-file import aliases (`import { putJson as pj }`). */
function helperNames(source) {
  const names = new Set(R2_KEY_HELPERS);
  const aliased = new RegExp("\\b(" + R2_KEY_HELPERS.join("|") + ")\\s+as\\s+([A-Za-z_$][\\w$]*)", "g");
  for (const match of source.matchAll(aliased)) names.add(match[2]);
  return names;
}

/**
 * Scan literal producers and readers for named R2 bindings and R2 key
 * helpers. Resolve same-file const keys only when the name has one value in
 * the file. Imported/computed/ambiguous keys are NOT assumed safe: record
 * every occurrence in the reviewed dynamic-reference ledger.
 *
 * This is deliberately a conservative source scanner, not a TypeScript
 * compiler. It does not infer storage semantics from arbitrary Map/KV calls.
 */
export function extractArtifactKeys(source, path) {
  const hits = [];
  const unresolved = [];
  const literal = "([\\\"'\\x60])((?:\\\\.|(?!\\1)[^\\n])*?)\\1";
  // Explicit R2 key positions are recorded whatever the key looks like; an
  // empty key cannot be documented, so it is reported as a dynamic call.
  const addHit = (index, key, kind) => {
    if (key.length > 0) hits.push({ path, line: lineOf(source, index), key: normalizeArtifactKey(key), kind });
    else unresolved.push({ path, line: lineOf(source, index), kind, expression: '""' });
  };
  // A local key declaration is resolved only when an R2 call uses it and
  // every same-named declaration in the file agrees (no scope analysis).
  const constants = new Map();
  // Group 1 is the constant name; group 2 is the opening quote, with
  // the same-quote backreference \2. Never reuse literal's \1 here.
  const declarations = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(["'\x60])((?:\\.|(?!\2)[^\n])*?)\2(?=\s*[;,\n)])/g;
  for (const match of source.matchAll(declarations)) {
    const previous = constants.get(match[1]);
    constants.set(match[1], previous === undefined || previous === match[3] ? match[3] : null);
  }

  const property = new RegExp("\\br2Key\\s*:\\s*" + literal, "g");
  for (const match of source.matchAll(property)) addHit(match.index, match[2], "r2Key");

  // Existing *_KEY producers are tracked even when the use site imports them.
  const named = new RegExp(
    "\\b(?:export\\s+)?const\\s+(?:[A-Z][A-Z0-9_]*(?:_OBJECT|_R2|_ARTIFACT|_RECENT_LIST|_TRENDING_OUTPUT)_KEY)\\s*=\\s*" + literal, "g",
  );
  for (const match of source.matchAll(named)) addHit(match.index, match[2], "object-constant");

  // The key argument must end at `,` or `)`; `"a/" + id` is not the key "a/".
  const argumentEnd = "(?=\\s*[,)])";
  const keyArgument = (index, after, kind) => {
    const quoted = new RegExp("^" + literal + argumentEnd).exec(after);
    if (quoted) {
      addHit(index, quoted[2], kind);
      return;
    }
    const whole = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\([^()\n]*\))?)(?=\s*[,)])/.exec(after)?.[1];
    const expression = whole ?? (new RegExp("^" + literal).test(after) ? undefined
      : /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\([^()\n]*\))?)/.exec(after)?.[1]);
    if (whole && typeof constants.get(whole) === "string") {
      addHit(index, constants.get(whole), kind + "-const");
    } else {
      // Imported, computed, or ambiguous: needs an explicit bounded exception
      // until a future MIG resolves the reader.
      unresolved.push({ path, line: lineOf(source, index), kind, expression: expression ?? "<complex>" });
    }
  };

  const bindings = [...bindingAliases(source)].map(escapeRegExp).join("|");
  // `?.`, `!.` and type arguments are allowed; list/multipart take options or
  // a key and are audited like the other operations.
  const calls = new RegExp("(?<![\\w$])(?:env\\.)?(?:" + bindings + ")\\s*(?:\\?\\.|!\\.|\\.)\\s*" +
    "(get|put|head|delete|list|createMultipartUpload|resumeMultipartUpload)\\s*(?:<[^>()]*>)?\\s*\\(\\s*", "g");
  for (const match of source.matchAll(calls)) {
    keyArgument(match.index, source.slice(match.index + match[0].length), "bucket." + match[1]);
  }
  // Helper calls: skip the first argument (env/bucket), read the second.
  // Member calls (`ns.putJson(`) count too; method declarations are skipped below.
  const helpers = new RegExp("(?<![\\w$])(" + [...helperNames(source)].map(escapeRegExp).join("|") + ")(?:<[^>()]*>)?\\s*\\(\\s*", "g");
  for (const match of source.matchAll(helpers)) {
    const rest = source.slice(match.index + match[0].length);
    const first = /^[^,()]*(?:\([^()]*\)[^,()]*)*,\s*/.exec(rest);
    // A declaration (`putJson(env: Env, key: string`) has a typed parameter.
    if (!first || /^[\w$]+\s*\??\s*:/.test(rest) || /\bfunction\s+[\w$]+(?:<[^>()]*>)?\s*\($/.test(source.slice(0, match.index + match[0].length).split("\n").pop())) continue;
    keyArgument(match.index, rest.slice(first[0].length), match[1]);
  }
  // Detection rules are grouped by syntax. Return references in source order,
  // not grouped by rule, so line-based diagnostics and consumer tests stay stable.
  hits.sort((a, b) => a.line - b.line);
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

const PLACEHOLDER_CELL = /^(?:|-+|—+|–+|tbd|todo|n\/a|none|unknown|\?+)$/i;

/** Rows of every table whose header starts with `| Artifact key |`. */
export function readInventoryRows(markdown) {
  const rows = [];
  let inTable = false;
  markdown.split("\n").forEach((line, index) => {
    if (/^\|\s*Artifact key\s*\|/.test(line)) {
      inTable = true;
      return;
    }
    if (!line.startsWith("|")) {
      inTable = false;
      return;
    }
    if (!inTable || /^\|[\s:|-]+\|$/.test(line)) return;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    rows.push({ line: index + 1, cells, key: /^`([^`]+)`$/.exec(cells[0])?.[1] ?? null });
  });
  return rows;
}

/** Every key row must name a producer, consumer, target/retention and owner MIG. */
export function validateInventoryRows(rows) {
  const invalid = [];
  for (const row of rows) {
    const reasons = [];
    if (!row.key) reasons.push("key cell is not one `code` value");
    if (row.cells.length !== 5) reasons.push("expected 5 cells, got " + row.cells.length);
    ["producer", "consumer", "target/retention", "owner MIG"].forEach((name, offset) => {
      const cell = row.cells[offset + 1] ?? "";
      if (PLACEHOLDER_CELL.test(cell)) reasons.push("empty " + name);
    });
    if (row.cells[4] !== undefined && !/\bMIG-\d{4}\b/.test(row.cells[4])) reasons.push("owner has no MIG-XXXX");
    if (reasons.length) invalid.push({ line: row.line, key: row.key, reasons });
  }
  return invalid;
}

export function readInventoryKeys(markdown) {
  return new Set(readInventoryRows(markdown).map((row) => row.key).filter(Boolean));
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
  const rows = readInventoryRows(inventoryText);
  const invalid = validateInventoryRows(rows);
  const known = new Set(rows.map((row) => row.key).filter(Boolean));
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
  // Counts are exact: a new call site fails, and a removed one must also be
  // removed from the ledger so it never documents a reference that is gone.
  for (const key of exceptions.keys()) if (!counts.has(key)) counts.set(key, 0);
  const unexpected = [...counts].filter(([key, count]) => count !== (exceptions.get(key) ?? 0))
    .map(([key, count]) => ({ key, count, limit: exceptions.get(key) ?? 0 }));
  return { known, invalid, hits, missing, unresolved, unexpected };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const root = resolve(dirname(self), "..");
  const inventoryText = readFileSync(join(root, "docs/migration/R2_ARTIFACT_CONSUMERS.md"), "utf8");
  const result = checkInventory({ root, inventoryText });
  if (result.invalid.length || result.missing.length || result.unexpected.length) {
    console.error("MIG-0649: R2 artifact inventory check failed:");
    for (const { line, key, reasons } of result.invalid) {
      console.error("docs/migration/R2_ARTIFACT_CONSUMERS.md:" + line + " " + (key ?? "<no key>") + " " + reasons.join("; "));
    }
    for (const { path, line, key, kind } of result.missing) {
      console.error(path + ":" + line + " " + kind + " undocumented key " + key);
    }
    for (const { key, count, limit } of result.unexpected) {
      console.error("dynamic R2 call count mismatch: " + key + " count=" + count + " documented=" + limit);
    }
    process.exitCode = 1;
  } else {
    console.log("MIG-0649 R2 inventory OK: " + result.hits.length + " references; " + result.known.size + " key patterns; " + result.unresolved.length + " reviewed dynamic call instances");
  }
}

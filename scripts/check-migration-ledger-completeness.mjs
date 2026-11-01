#!/usr/bin/env node
// MIG-0622: every tracked CURRENT source file must be named by FILE_MIGRATION_MATRIX.md,
// either by an exact ledger row or by a directory family row (`dir/**`).
// check-migration-file-progress.mjs only validates files that already have a row, so
// this checker closes the gap for files nobody listed (G11).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFileRows, parseMigs } from "./check-migration-file-progress.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Directories whose tracked files are all required (unless excluded below).
export const REQUIRED_DIRS = ["app/", "src/lib/", "src/components/", "src/styles/", "public/", "workers/", "cloudflare/"];
// Small flat directory with one owner: a whole-directory family row is a genuine mapping, not a vacuous cover-all.
const SINGLE_OWNER_DIRS = ["src/styles/"];
// Repository-root files that are required.
export const REQUIRED_ROOT_FILES = [
  "middleware.ts", "next.config.mjs", "open-next.config.ts", "instrumentation.ts", "next-env.d.ts",
  "wrangler.toml", "drizzle.config.ts", "tsconfig.json", "tsconfig.base.json", "package.json", "package-lock.json",
];
// Deliberate exclusions. apps/** and packages/** are owned by check-migration-file-progress
// (isTrackedSourceCandidate); migrations/**, scripts/**, docs/** and tooling are not CURRENT product source.
export const EXCLUDED_PATTERNS = [
  [/\.(?:test|spec)\.[cm]?[jt]sx?$/, "test file"],
  [/\.fixture\.[cm]?[jt]sx?$/, "test fixture"],
  [/(?:^|\/)__tests__\//, "test directory"],
  [/(?:^|\/)(?:node_modules|dist|\.next|\.wrangler|\.astro|coverage)\//, "generated or vendored output"],
];
export function exclusionReason(file) {
  for (const [re, reason] of EXCLUDED_PATTERNS) if (re.test(file)) return reason;
  return null;
}
export function isRequiredSource(file) {
  if (exclusionReason(file)) return false;
  return REQUIRED_ROOT_FILES.includes(file) || REQUIRED_DIRS.some((d) => file.startsWith(d));
}

// Family rows live in "## Source families" (after the ledger, so parseFileRows ignores them).
export function parseFamilyRows(markdown) {
  const text = markdown.replace(/\r\n/g, "\n");
  const section = text.split("\n## Source families")[1]?.split("\n## ")[0];
  const rows = [], errors = [];
  if (!section) return { rows, errors: ["FILE_MIGRATION_MATRIX: missing '## Source families' section"] };

  const lines = section.split("\n");
  const headerIndex = lines.findIndex((line) => /^\|\s*Family\s*\|/.test(line.trim()));
  if (headerIndex < 0) return { rows, errors: ["FILE_MIGRATION_MATRIX: missing family table header"] };

  const cellsOf = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const header = lines[headerIndex].trim();
  if (!header.endsWith("|") || cellsOf(header).length !== 5) {
    errors.push("invalid family table header: " + header.slice(0, 90));
  }

  const separator = lines[headerIndex + 1]?.trim() ?? "";
  if (!separator.startsWith("|") || !separator.endsWith("|") ||
      cellsOf(separator).length !== 5 ||
      !cellsOf(separator).every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return { rows, errors: [...errors, "invalid family table separator"] };
  }

  const allowedStates = new Set([
    "NOT_STARTED", "IN_PROGRESS", "BRIDGED", "PARITY_VERIFIED",
    "CUTOVER", "RETIRED", "RETAINED", "BLOCKED",
  ]);
  for (const line of lines.slice(headerIndex + 2)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Stop at prose after the table, but inspect malformed rows that lost a
    // leading pipe or backtick instead of silently dropping the family.
    if (!trimmed.startsWith("|") &&
        !/^(?:\x60|app\/|src\/|public\/|workers\/|cloudflare\/)/.test(trimmed)) break;
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      errors.push("malformed family row: " + trimmed.slice(0, 90));
      continue;
    }
    const cells = cellsOf(trimmed);
    if (cells.length !== 5) {
      errors.push("family row has " + cells.length + " columns, expected 5: " + trimmed.slice(0, 90));
      continue;
    }
    if (!/^\x60[^\x60]+\x60$/.test(cells[0])) {
      errors.push("invalid family path cell: " + cells[0]);
      continue;
    }
    const pattern = cells[0].slice(1, -1);
    if (!pattern.endsWith("/**") || pattern.slice(0, -3).includes("*")) {
      errors.push("family pattern must be 'dir/**': " + pattern);
      continue;
    }
    const prefix = pattern.slice(0, -2);
    if (REQUIRED_DIRS.includes(prefix) && !SINGLE_OWNER_DIRS.includes(prefix)) {
      errors.push("family pattern must be below a top-level required directory (would cover everything): " + pattern);
      continue;
    }
    if (!cells[1]) errors.push(pattern + " has empty kind");
    if (!allowedStates.has(cells[4])) errors.push(pattern + " invalid family state " + cells[4]);
    rows.push({ prefix, pattern, kind: cells[1], owner: cells[2], target: cells[3], state: cells[4] });
  }
  return { rows, errors };
}

export function validateLedgerCompleteness({ matrix, status, trackedFiles }) {
  const errors = [];
  const { rows: exact, errors: exactErrors } = parseFileRows(matrix);
  errors.push(...exactErrors);
  const { rows: families, errors: familyErrors } = parseFamilyRows(matrix);
  errors.push(...familyErrors);
  const migs = parseMigs(status);
  const seen = new Set();
  for (const fam of families) {
    if (seen.has(fam.pattern)) errors.push("duplicate family row: " + fam.pattern);
    seen.add(fam.pattern);
    if (!migs.has(fam.owner)) errors.push(fam.pattern + " references missing owner task " + fam.owner);
    if (!fam.kind) errors.push(fam.pattern + " has empty kind");
  }
  const required = trackedFiles.filter(isRequiredSource);
  const used = new Set();
  for (const file of required) {
    if (exact.has(file)) continue;
    const matches = families.filter((f) => file.startsWith(f.prefix));
    if (matches.length) {
      // Exact rows win, but overlapping family rows must not silently select
      // whichever owner happens to appear first in the Markdown table.
      for (const fam of matches) used.add(fam.pattern);
      if (new Set(matches.map((f) => f.owner)).size > 1) {
        errors.push("ambiguous family ownership for " + file + ": " +
          matches.map((f) => f.pattern + " (" + f.owner + ")").join(", "));
      }
      continue;
    }
    errors.push("tracked source has no FILE_MIGRATION_MATRIX row or family: " + file);
  }
  for (const fam of families) {
    if (!used.has(fam.pattern) && !required.some((f) => f.startsWith(fam.prefix))) errors.push("stale family row matches no tracked source: " + fam.pattern);
  }
  return errors;
}

export function listTrackedFiles(root = ROOT) {
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return raw.split("\0").filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const matrix = read("docs/migration/FILE_MIGRATION_MATRIX.md");
  const trackedFiles = listTrackedFiles();
  const errors = validateLedgerCompleteness({ matrix, status: read("docs/migration/STATUS.md"), trackedFiles });
  for (const e of errors) console.error("[migration-ledger] " + e);
  if (errors.length) process.exitCode = 1;
  else {
    const required = trackedFiles.filter(isRequiredSource);
    const excluded = trackedFiles.filter((f) => (REQUIRED_ROOT_FILES.includes(f) || REQUIRED_DIRS.some((d) => f.startsWith(d))) && exclusionReason(f)).length;
    console.log("[migration-ledger] PASS: " + required.length + " required source files covered (" + parseFileRows(matrix).rows.size + " exact rows, " + parseFamilyRows(matrix).rows.length + " families); " + excluded + " excluded as test/generated");
  }
}

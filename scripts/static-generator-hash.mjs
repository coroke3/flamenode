// Static generator source hash.
//
// deploy 時の全 global rebuild enqueue（ensureDeployGlobalRebuilds）が commit SHA ではなく
// 「静的 rebuild 経路のソース」が変わったときだけ走るよう、json-generator の root module から
// 相対 import / export / 文字列リテラル dynamic import を辿った推移閉包を sha256 化する。
// 内容は CRLF→LF 正規化し、repo 相対 path（/ 区切り）でソートして OS 非依存にする。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** content-jobs が静的 rebuild のために import する json-generator module（repo 相対）。 */
export const STATIC_GENERATOR_ROOTS = [
  "workers/json-generator/queue.ts",
  "workers/json-generator/optimizedRebuild.ts",
  "workers/json-generator/rebuild.ts",
  "workers/json-generator/deployGlobalRebuildEnqueue.ts",
  "workers/json-generator/eventPlaylistBackfill.ts",
  "workers/json-generator/topSectionsEnqueue.ts",
  "workers/json-generator/topSlotStatsEnqueue.ts",
  "workers/json-generator/usersSharedInputsEnqueue.ts",
  "workers/json-generator/youtubeRelatedSharedInputsEnqueue.ts",
];

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"];
const TEST_FILE_PATTERN = /\.test\.[^/]+$/;

/**
 * Parse real module references instead of matching import-like text in comments
 * or string literals. A false-negative here can suppress a needed global rebuild.
 */
export function extractRelativeSpecifiers(source, fileName = "static-generator-source.ts") {
  const scriptKind = path.extname(fileName) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const specifiers = new Set();
  const add = (module) => {
    if (
      module &&
      ts.isStringLiteralLike(module) &&
      (module.text.startsWith("./") || module.text.startsWith("../"))
    ) {
      specifiers.add(module.text);
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...specifiers];
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveSpecifier(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base];
  if (/\.(?:js|mjs)$/.test(base)) {
    candidates.push(base.replace(/\.(js|mjs)$/, ".ts"));
  }
  for (const extension of CODE_EXTENSIONS) candidates.push(`${base}${extension}`);
  for (const extension of CODE_EXTENSIONS) {
    candidates.push(path.join(base, `index${extension}`));
  }
  return candidates.find(isFile) ?? null;
}

function toRepoRelative(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

/** 推移閉包に含まれる repo 相対 path（ソート済み）。 */
export function collectStaticGeneratorFiles(
  repoRoot,
  roots = STATIC_GENERATOR_ROOTS,
) {
  const root = path.resolve(repoRoot);
  const visited = new Set();
  const queue = roots.map((relative) => {
    const absolute = path.resolve(root, relative);
    if (!isFile(absolute)) {
      throw new Error(`static generator root is missing: ${relative}`);
    }
    return absolute;
  });
  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (!CODE_EXTENSIONS.includes(path.extname(current))) continue;
    const source = fs.readFileSync(current, "utf8");
    for (const specifier of extractRelativeSpecifiers(source, current)) {
      const resolved = resolveSpecifier(current, specifier);
      if (!resolved) {
        throw new Error(
          `${toRepoRelative(root, current)}: cannot resolve relative import "${specifier}"`,
        );
      }
      const relative = toRepoRelative(root, resolved);
      if (relative.startsWith("../")) continue;
      if (TEST_FILE_PATTERN.test(relative)) continue;
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }
  return [...visited].map((file) => toRepoRelative(root, file)).sort();
}

export function computeStaticGeneratorHash(
  repoRoot,
  roots = STATIC_GENERATOR_ROOTS,
) {
  const files = collectStaticGeneratorFiles(repoRoot, roots);
  const hash = crypto.createHash("sha256");
  for (const relative of files) {
    const content = fs
      .readFileSync(path.resolve(repoRoot, relative), "utf8")
      .replace(/\r\n/g, "\n");
    hash.update(relative);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = collectStaticGeneratorFiles(repoRoot);
  const hash = computeStaticGeneratorHash(repoRoot);
  if (process.argv.includes("--list")) {
    for (const file of files) console.log(file);
  }
  console.log(`roots: ${STATIC_GENERATOR_ROOTS.length}`);
  console.log(`files: ${files.length}`);
  console.log(`hash: ${hash}`);
}

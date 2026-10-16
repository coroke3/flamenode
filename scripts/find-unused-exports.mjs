#!/usr/bin/env node
// 移行する file の export ごとに、他の file からの参照数を数える（CODE_QUALITY.md「移行で守る簡潔さ」の 2）。
// 識別子の一致だけを見る粗い走査。0件でも文字列で参照される可能性があるので、移さない前に PR で理由を書く。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SEARCH_DIRS = ["src", "app", "workers", "scripts", "packages", "apps"];
const EXPORT_PATTERN = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

export function exportedNames(sourceText) {
  return [...sourceText.matchAll(EXPORT_PATTERN)].map((m) => m[1]);
}

// files: Map<path, text>. Returns one row per export of each target.
export function countReferences(targets, files) {
  const filesByName = new Map();
  for (const [file, text] of files) {
    for (const name of new Set(text.match(IDENTIFIER) ?? [])) {
      if (!filesByName.has(name)) filesByName.set(name, []);
      filesByName.get(name).push(file);
    }
  }
  return targets.flatMap((target) => exportedNames(files.get(target) ?? "").map((name) => {
    const others = (filesByName.get(name) ?? []).filter((file) => file !== target);
    const tests = others.filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file));
    const localUses = (files.get(target).match(new RegExp("(?<![\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g")) ?? []).length - 1;
    return { file: target, name, nonTest: others.length - tests.length, test: tests.length, local: localUses };
  }));
}

function listSourceFiles(root) {
  const existing = SEARCH_DIRS.filter((dir) => fs.existsSync(path.join(root, dir)));
  return execFileSync("git", ["ls-files", "--", ...existing], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.(ts|tsx|mjs|js|cjs)$/.test(file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.error("usage: node scripts/find-unused-exports.mjs <file> [file...]");
    process.exit(2);
  }
  const root = process.cwd();
  const files = new Map([...new Set([...listSourceFiles(root), ...targets])].map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
  for (const row of countReferences(targets, files)) {
    // LOCAL_ONLY: 同じ file の中だけで使う。移すが export しない。TEST_ONLY / UNUSED: 移さない候補。
    const verdict = row.nonTest > 0 ? "used" : row.local > 0 ? "LOCAL_ONLY" : row.test > 0 ? "TEST_ONLY" : "UNUSED";
    console.log([verdict, row.file, row.name, "non-test=" + row.nonTest, "test=" + row.test, "local=" + row.local].join("\t"));
  }
}

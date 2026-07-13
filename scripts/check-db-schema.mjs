#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDbSchema as validateBaseSchema } from "./check-db-schema.base.mjs";

export * from "./check-db-schema.base.mjs";

const FRAGMENT_IMPORT_PATTERN = /(?:from\s+|import\s*\()?["'][^"']*schema\.base(?:\.ts)?["']/;

function collectSourceFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".vercel", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, result);
    else if (entry.isFile() && /\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

function assertSchemaEntryPoint(root) {
  const entryPath = path.join(root, "src", "lib", "db", "schema.ts");
  const fragmentPath = path.join(root, "src", "lib", "db", "schema.base.ts");
  if (!fs.existsSync(entryPath)) throw new Error("src/lib/db/schema.tsがありません。");
  if (!fs.existsSync(fragmentPath)) throw new Error("内部schema fragmentがありません。");

  const entry = fs.readFileSync(entryPath, "utf8");
  if (!/唯一の公開正本/.test(entry)) {
    throw new Error("schema.tsへ唯一の公開正本であることを明示してください。");
  }
  if (!/export\s+\*\s+from\s+["']\.\/schema\.base\.ts["']/.test(entry)) {
    throw new Error("schema.tsは内部fragmentを最終entrypointとして再exportする必要があります。");
  }

  const allowed = new Set([
    path.normalize(entryPath),
    path.normalize(path.join(root, "scripts", "check-db-schema.mjs")),
  ]);
  for (const sourceRoot of ["app", "src", "workers", "scripts"]) {
    for (const sourceFile of collectSourceFiles(path.join(root, sourceRoot))) {
      const normalized = path.normalize(sourceFile);
      if (allowed.has(normalized)) continue;
      const body = fs.readFileSync(sourceFile, "utf8");
      if (FRAGMENT_IMPORT_PATTERN.test(body)) {
        throw new Error(
          `${path.relative(root, sourceFile)}: schema.base.tsを直接参照できません。src/lib/db/schema.tsからimportしてください。`,
        );
      }
    }
  }
}

/** static parserがindex builderの末尾commaを同一表現として扱えるよう正規化する。 */
function normalizeSchemaForManifest(schemaText) {
  return schemaText.replace(
    /\b(uniqueIndex|index)\s*\(\s*(["'][A-Za-z0-9_]+["'])\s*,\s*\)/g,
    "$1($2)",
  );
}

/**
 * schema.tsを唯一の公開正本として検査する。
 * static parser向けに、schema.tsだけが所有する内部fragmentと最終overrideを
 * 一時fileへ合成し、active migrationとの完全一致を確認する。
 */
export function validateDbSchema(root = process.cwd()) {
  assertSchemaEntryPoint(root);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-schema-check-"));
  try {
    fs.cpSync(path.join(root, "migrations"), path.join(tempRoot, "migrations"), {
      recursive: true,
    });
    const tempDbDir = path.join(tempRoot, "src", "lib", "db");
    fs.mkdirSync(tempDbDir, { recursive: true });

    const fragmentPath = path.join(root, "src", "lib", "db", "schema.base.ts");
    const schemaEntryPath = path.join(root, "src", "lib", "db", "schema.ts");
    const flattened = [
      fs.readFileSync(fragmentPath, "utf8"),
      "\n// ===== schema.ts final overrides =====\n",
      normalizeSchemaForManifest(fs.readFileSync(schemaEntryPath, "utf8")),
    ].join("\n");
    fs.writeFileSync(path.join(tempDbDir, "schema.ts"), flattened, "utf8");
    return validateBaseSchema(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = validateDbSchema(process.cwd());
    console.log(
      `[check:db-schema] OK: schema.ts is the sole public entrypoint; ${result.migrations.length} migrations, ` +
        `${result.tableCount} tables, ${result.indexCount} indexes, ` +
        `${result.foreignKeyCount} foreign keys, ${result.checkCount} checks.`,
    );
  } catch (error) {
    console.error(
      `[check:db-schema] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
